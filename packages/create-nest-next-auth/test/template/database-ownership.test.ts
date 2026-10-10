import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { DATABASE_CHOICE_MARKER_ID, ENGINE_SUITE_PACKAGES } from '../../src/constants/index.js';
import { loadManifest } from '../../src/manifest/load.js';
import { isRecord } from '../../src/manifest/read.js';
import { stripFeatureMarkers } from '../../src/prune/markers.js';
import type { Manifest } from '../../src/types.js';
import { listFiles } from '../../src/utils/fs.js';
import { matchesAnyGlob } from '../../src/utils/glob.js';

const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));
const BACKEND_SOURCE = /^backend\/(?:src|test)\/.*\.(?:ts|mts|mjs)$/;
// import ... from 'x' | import 'x' | import('x') | require('x') | jest.mock('x', ...)
const LOADED =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bjest\.(?:mock|doMock|requireActual|requireMock)\s*\(\s*)['"]([^'"]+)['"]/g;
const ENDINGS = ['', '.ts', '.mts', '.mjs', '.js', '.json', '/index.ts'];

const ENGINE_SUITE: readonly string[] = ENGINE_SUITE_PACKAGES;

let manifest: Manifest;
let backendFiles: string[];

beforeAll(async () => {
  manifest = await loadManifest(REPOSITORY);
  backendFiles = (await listFiles(join(REPOSITORY, 'backend')))
    .map((file) => `backend/${file}`)
    .filter((file) => BACKEND_SOURCE.test(file));
});

/** Every id a marker may name, and the ones a full project of one database keeps. */
function markerIds(database: string): { kept: Set<string>; known: Set<string> } {
  const shared = [
    ...Object.keys(manifest.features),
    ...Object.keys(manifest.options),
    ...Object.keys(manifest.targets),
    ...Object.keys(manifest.shared),
  ];
  return {
    kept: new Set([...shared, database]),
    known: new Set([...shared, ...Object.keys(manifest.databases), DATABASE_CHOICE_MARKER_ID]),
  };
}

/** What a project of one database deletes whatever else was picked. */
function removedGlobs(database: string): string[] {
  const others = Object.entries(manifest.databases).filter(([id]) => id !== database);
  return [...manifest.core.alwaysRemoveFiles, ...others.flatMap(([, entry]) => entry.files)];
}

function resolvedFile(importer: string, specifier: string): string | undefined {
  const base = resolve(REPOSITORY, dirname(importer), specifier);
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
function foreignLoads(database: string): string[] {
  const removed = removedGlobs(database);
  const { kept, known } = markerIds(database);
  const foreignPackages = Object.entries(manifest.databases)
    .filter(([id]) => id !== database)
    .flatMap(([, entry]) => entry.packages);
  const isForeignPackage = (specifier: string): boolean =>
    foreignPackages.some((name) => specifier === name || specifier.startsWith(`${name}/`));

  const problems: string[] = [];
  for (const file of backendFiles) {
    if (matchesAnyGlob(file, removed)) continue;
    const source = readFileSync(join(REPOSITORY, file), 'utf8');
    const stripped = stripFeatureMarkers(source, file, kept, known).content;
    // What the project holds once the database's own rewrites were applied.
    const content = manifest.databases[database].rewrites
      .filter((rewrite) => matchesAnyGlob(file, rewrite.files))
      .reduce((text, rewrite) => text.split(rewrite.from).join(rewrite.to), stripped);
    for (const match of content.matchAll(LOADED)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) {
        if (isForeignPackage(specifier)) problems.push(`${file} loads ${specifier}`);
        continue;
      }
      const target = resolvedFile(file, specifier);
      if (target !== undefined && matchesAnyGlob(target, removed)) {
        problems.push(`${file} loads ${target}`);
      }
    }
  }
  return problems;
}

describe('what a project of one database keeps', () => {
  it('loads no MongoDB package and no MongoDB file in a PostgreSQL project', () => {
    expect(foreignLoads('postgres')).toEqual([]);
  });

  it('loads no PostgreSQL package and no PostgreSQL file in a MongoDB project', () => {
    expect(foreignLoads('mongodb')).toEqual([]);
  });

  it('declares every package a database owns in the backend manifest', () => {
    const declared: unknown = JSON.parse(
      readFileSync(join(REPOSITORY, 'backend/package.json'), 'utf8'),
    );
    const groups = isRecord(declared) ? [declared.dependencies, declared.devDependencies] : [];
    const names = new Set(groups.flatMap((group) => (isRecord(group) ? Object.keys(group) : [])));

    expect(
      Object.values(manifest.databases)
        .flatMap((entry) => entry.packages)
        .filter((name) => !names.has(name)),
    ).toEqual([]);
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
      if (!match[1].startsWith('.')) loaded.add(match[1]);
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

    expect({ leftBehind, checked: packages.length > 30 }).toEqual({
      leftBehind: [],
      checked: true,
    });
  });
});

/** The PostgreSQL tables an optional feature owns, written out by hand. */
const FEATURE_TABLES: Record<string, { tables: string[]; migration: string }> = {
  totp: {
    tables: ['user_two_factor', 'user_recovery_codes', 'two_factor_challenges'],
    migration: '0008_two_factor.sql',
  },
  passkeys: { tables: ['passkeys', 'passkey_challenges'], migration: '0009_passkeys.sql' },
  'magic-link': { tables: ['pending_magic_links'], migration: '0013_magic_links.sql' },
};
const MIGRATIONS = 'backend/src/common/persistence/postgres/migrations';

describe('the PostgreSQL tables of an optional feature', () => {
  it.each(Object.keys(FEATURE_TABLES))(
    'are named by nothing a PostgreSQL project keeps once %s is left out',
    async (feature) => {
      const { tables, migration } = FEATURE_TABLES[feature];
      const removed = [...removedGlobs('postgres'), ...manifest.features[feature].files];
      const { kept, known } = markerIds('postgres');
      kept.delete(feature);
      // A table as a statement names it: in a query, in the table map or in SQL.
      const named = new RegExp(
        `(?:['"\`]|\\b(?:TABLE|ON|FROM|INTO|UPDATE|REFERENCES)\\s+)(?:${tables.join('|')})\\b|^\\s*(?:${tables.join('|')}):`,
        'm',
      );

      const files = [
        ...backendFiles,
        ...(await listFiles(join(REPOSITORY, MIGRATIONS))).map((file) => `${MIGRATIONS}/${file}`),
      ].filter((file) => /\/persistence\/postgres\/|^backend\/test\/postgres\//.test(file));
      const naming = files.filter((file) => {
        if (matchesAnyGlob(file, removed)) return false;
        const source = readFileSync(join(REPOSITORY, file), 'utf8');
        const content = file.endsWith('.sql')
          ? source
          : stripFeatureMarkers(source, file, kept, known).content;
        return named.test(content);
      });

      expect({
        naming,
        migrationLeft: !matchesAnyGlob(`${MIGRATIONS}/${migration}`, removed),
        checked: files.length > 50,
      }).toEqual({ naming: [], migrationLeft: false, checked: true });
    },
  );

  it('are created by a file of their own, so the list a pruned project carries stays in order', async () => {
    const all = (await listFiles(join(REPOSITORY, MIGRATIONS))).sort();
    const withoutOptional = all.filter(
      (file) =>
        !Object.values(FEATURE_TABLES).some(({ migration }) => migration === file) &&
        file.endsWith('.sql'),
    );

    expect(withoutOptional).toEqual([
      '0001_browser_issuance.sql',
      '0002_roles.sql',
      '0003_pending_codes.sql',
      '0004_browser_proofs_security_events.sql',
      '0005_accounts.sql',
      '0006_session_authority_revocation.sql',
      '0007_applications_grants.sql',
      '0010_native_sign_in.sql',
      '0011_session_listing.sql',
      '0012_retention_indexes.sql',
    ]);
    for (const file of withoutOptional) {
      const sql = readFileSync(join(REPOSITORY, MIGRATIONS, file), 'utf8')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n');
      for (const { tables } of Object.values(FEATURE_TABLES)) {
        for (const table of tables) {
          expect(new RegExp(`\\b${table}\\b`).test(sql), `${file} names ${table}`).toBe(false);
        }
      }
    }
  });
});

/** A file as a project of `database` holds it when the rewrites run: its markers taken out. */
function asProjectHolds(database: string, file: string): string {
  const source = readFileSync(join(REPOSITORY, file), 'utf8');
  if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file)) return source;
  const { kept, known } = markerIds(database);
  return stripFeatureMarkers(source, file, kept, known).content;
}

describe('what the chosen database renames and rewrites', () => {
  it('finds every text it rewrites in the repository, in a file the rule names', async () => {
    const tracked = await listFiles(REPOSITORY);
    const stale: string[] = [];
    for (const [id, database] of Object.entries(manifest.databases)) {
      // A rule names a file as the project has it, after the renames.
      const before = new Map(Object.entries(database.renames).map(([from, to]) => [to, from]));
      const sources = tracked.map((file): [string, string] => [file, file]);
      for (const [to, from] of before) sources.push([to, from]);
      for (const rewrite of database.rewrites) {
        const found = sources.some(
          ([name, file]) =>
            matchesAnyGlob(name, rewrite.files) &&
            existsSync(join(REPOSITORY, file)) &&
            asProjectHolds(id, file).includes(rewrite.from),
        );
        if (!found) stale.push(`${id}: ${JSON.stringify(rewrite.from)}`);
      }
    }

    expect(stale).toEqual([]);
  });

  it('renames only files the repository carries, to names the other database frees', async () => {
    const tracked = new Set(await listFiles(REPOSITORY));
    const problems: string[] = [];
    for (const [id, database] of Object.entries(manifest.databases)) {
      const freed = Object.entries(manifest.databases)
        .filter(([other]) => other !== id)
        .flatMap(([, other]) => other.files);
      for (const [from, to] of Object.entries(database.renames)) {
        if (!tracked.has(from)) problems.push(`${id} renames ${from}, which is not there`);
        if (tracked.has(to) && !matchesAnyGlob(to, freed)) {
          problems.push(`${id} renames ${from} to ${to}, which no other database gives up`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
