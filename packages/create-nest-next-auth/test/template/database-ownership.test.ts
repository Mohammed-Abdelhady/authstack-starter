import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENGINE_SUITE_PACKAGES } from '../../src/constants/index.js';
import { isRecord } from '../../src/manifest/read.js';
import { stripFeatureMarkers } from '../../src/prune/markers.js';
import type { Manifest } from '../../src/types.js';
import { matchesAnyGlob } from '../../src/utils/glob.js';
import {
  markerIds as markerIdsOf,
  readOwnershipSource,
  removedGlobs as removedGlobsOf,
  REPOSITORY,
} from './database-ownership-support.js';

let manifest: Manifest;
let backendFiles: string[];

beforeAll(async () => {
  ({ manifest, backendFiles } = await readOwnershipSource());
});

const markerIds = (database: string) => markerIdsOf(manifest, database);
const removedGlobs = (database: string) => removedGlobsOf(manifest, database);

// import ... from 'x' | import 'x' | import('x') | require('x') | jest.mock('x', ...)
const LOADED =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bjest\.(?:mock|doMock|requireActual|requireMock)\s*\(\s*)['"]([^'"]+)['"]/g;
const ENDINGS = ['', '.ts', '.mts', '.mjs', '.js', '.json', '/index.ts'];

const ENGINE_SUITE: readonly string[] = ENGINE_SUITE_PACKAGES;

/** `baseUrl` is the backend folder, so `src/...` and `test/...` are paths too. */
const ROOTED = /^(?:src|test)\//;

function isPath(specifier: string): boolean {
  return specifier.startsWith('.') || ROOTED.test(specifier);
}

function resolvedFile(importer: string, specifier: string): string | undefined {
  const base = ROOTED.test(specifier)
    ? resolve(REPOSITORY, 'backend', specifier)
    : resolve(REPOSITORY, dirname(importer), specifier);
  for (const ending of ENDINGS) {
    const candidate = base + ending;
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return posix.relative(REPOSITORY.split('\\').join('/'), candidate.split('\\').join('/'));
    }
  }
  return undefined;
}

/**
 * For the backend files a project of `database` keeps, with the lines of the
 * other database taken out: every load of the other database's packages, and
 * every load of a file the project deletes.
 */
function foreignLoads(database: string): {
  problems: string[];
  unresolved: string[];
  scanned: number;
  loaded: Set<string>;
} {
  const removed = removedGlobs(database);
  const { kept, known } = markerIds(database);
  const foreignPackages = Object.entries(manifest.databases)
    .filter(([id]) => id !== database)
    .flatMap(([, entry]) => entry.packages);
  const isForeignPackage = (specifier: string): boolean =>
    foreignPackages.some((name) => specifier === name || specifier.startsWith(`${name}/`));

  const problems: string[] = [];
  const unresolved: string[] = [];
  const loaded = new Set<string>();
  let scanned = 0;
  for (const file of backendFiles) {
    if (matchesAnyGlob(file, removed)) continue;
    scanned += 1;
    const source = readFileSync(join(REPOSITORY, file), 'utf8');
    const stripped = stripFeatureMarkers(source, file, kept, known).content;
    // What the project holds once the database's own rewrites were applied.
    const content = manifest.databases[database].rewrites
      .filter((rewrite) => matchesAnyGlob(file, rewrite.files))
      .reduce((text, rewrite) => text.split(rewrite.from).join(rewrite.to), stripped);
    for (const match of content.matchAll(LOADED)) {
      const specifier = match[1];
      if (!isPath(specifier)) {
        loaded.add(specifier);
        if (isForeignPackage(specifier)) problems.push(`${file} loads ${specifier}`);
        continue;
      }
      const target = resolvedFile(file, specifier);
      // A path that resolves to nothing could be a load of a deleted file.
      if (target === undefined) unresolved.push(`${file} loads ${specifier}`);
      else if (matchesAnyGlob(target, removed)) problems.push(`${file} loads ${target}`);
    }
  }
  return { problems, unresolved, scanned, loaded };
}

describe('what a project of one database keeps', () => {
  it('loads no MongoDB package and no MongoDB file in a PostgreSQL project', () => {
    const { problems, unresolved, scanned, loaded } = foreignLoads('postgres');

    // The controls: the scan read the backend, and saw the project's own driver.
    expect({ problems, unresolved, read: scanned > 400, ownDriver: loaded.has('pg') }).toEqual({
      problems: [],
      unresolved: [],
      read: true,
      ownDriver: true,
    });
  });

  it('loads no PostgreSQL package and no PostgreSQL file in a MongoDB project', () => {
    const { problems, unresolved, scanned, loaded } = foreignLoads('mongodb');

    expect({
      problems,
      unresolved,
      read: scanned > 400,
      ownDriver: loaded.has('mongoose'),
    }).toEqual({ problems: [], unresolved: [], read: true, ownDriver: true });
  });

  it('declares every package a database owns in the backend manifest', () => {
    const declared: unknown = JSON.parse(
      readFileSync(join(REPOSITORY, 'backend/package.json'), 'utf8'),
    );
    const groups = isRecord(declared) ? [declared.dependencies, declared.devDependencies] : [];
    const names = new Set(groups.flatMap((group) => (isRecord(group) ? Object.keys(group) : [])));

    const owned = Object.values(manifest.databases).flatMap((entry) => entry.packages);

    expect({ missing: owned.filter((name) => !names.has(name)), owned: owned.length > 0 }).toEqual({
      missing: [],
      owned: true,
    });
  });
});

/** Every package the backend files a project of `database` keeps still load. */
function loadedPackages(database: string): Set<string> {
  const removed = removedGlobs(database);
  const { kept, known } = markerIds(database);
  const loaded = new Set<string>();
  for (const file of backendFiles) {
    if (matchesAnyGlob(file, removed)) continue;
    const source = readFileSync(join(REPOSITORY, file), 'utf8');
    const stripped = stripFeatureMarkers(source, file, kept, known).content;
    const content = manifest.databases[database].rewrites
      .filter((rewrite) => matchesAnyGlob(file, rewrite.files))
      .reduce((text, rewrite) => text.split(rewrite.from).join(rewrite.to), stripped);
    for (const match of content.matchAll(LOADED)) {
      if (!isPath(match[1])) loaded.add(match[1]);
    }
  }
  return loaded;
}

describe('the packages only one database loads', () => {
  it('are owned by that database, so a project of the other one does not install them', () => {
    const declared: unknown = JSON.parse(
      readFileSync(join(REPOSITORY, 'backend/package.json'), 'utf8'),
    );
    const groups = isRecord(declared) ? [declared.dependencies, declared.devDependencies] : [];
    const packages = groups.flatMap((group) => (isRecord(group) ? Object.keys(group) : []));
    // What some backend file of this repository loads at all. A tool that is
    // only run from a script, such as a linter, is not judged here.
    const loadedAnywhere = new Set<string>();
    for (const file of backendFiles) {
      const source = readFileSync(join(REPOSITORY, file), 'utf8');
      for (const match of source.matchAll(LOADED)) loadedAnywhere.add(match[1]);
    }
    const isLoaded = (loaded: Set<string>, name: string): boolean => {
      // Type packages follow the package they describe.
      const runtime = name.startsWith('@types/') ? name.slice('@types/'.length) : name;
      return [...loaded].some(
        (specifier) => specifier === runtime || specifier.startsWith(`${runtime}/`),
      );
    };

    const leftBehind: string[] = [];
    for (const id of Object.keys(manifest.databases)) {
      const loaded = loadedPackages(id);
      const pruned = Object.entries(manifest.databases)
        .filter(([other]) => other !== id)
        .flatMap(([, entry]) => entry.packages);
      for (const name of packages) {
        // The scaffold takes the engine suite's package out of every project.
        if (ENGINE_SUITE.includes(name)) continue;
        if (!isLoaded(loadedAnywhere, name) || pruned.includes(name)) continue;
        if (!isLoaded(loaded, name)) {
          leftBehind.push(`${name} stays in a ${id} project, where nothing loads it`);
        }
      }
    }

    // The controls: packages were declared, files were read, and each project
    // was seen to load a package the other one gives up.
    expect({
      leftBehind,
      declared: packages.length > 30,
      loadedAnywhere: loadedAnywhere.size > 30,
      ownDrivers: [loadedPackages('postgres').has('pg'), loadedPackages('mongodb').has('mongoose')],
      givenUp: [loadedPackages('postgres').has('mongoose'), loadedPackages('mongodb').has('pg')],
    }).toEqual({
      leftBehind: [],
      declared: true,
      loadedAnywhere: true,
      ownDrivers: [true, true],
      givenUp: [false, false],
    });
  });
});
