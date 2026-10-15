import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../../src/manifest/load.js';
import { stripFeatureMarkers } from '../../src/prune/markers.js';
import { matchesAnyGlob } from '../../src/utils/glob.js';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const BACKEND_SOURCE = 'backend/src';
const BACKEND_TESTS = 'backend/test';
const API_PREFIX = '/api';
const CONTROLLER_FILE = /\.controller\.ts$/;
const CONTROLLER_BASE = /@Controller\(\s*(?:'([^']*)')?\s*\)/;
const HANDLER_PATH = /@(?:Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)/g;
const MARKER_ID_LIST = /(?:\/\/|\{\/\*)\s*feature:([a-z0-9,-]+)/g;
const SPEC_FILE = /\.(?:e2e-)?spec\.ts$/;
const TEST_CALL = /\b(?:it|test)(?:\.each)?\s*[(`]/;
const DATABASE_CHOICE = 'database-choice';

interface OwnedFeature {
  files: string[];
  requires: string[];
}

interface LeftBehind {
  file: string;
  feature: string;
  route: string;
}

/** Who owns which files, as far as keeping a spec at all goes. */
interface SpecOwners {
  /** Every feature, option, target, shared module and database id, with its globs. */
  files: Record<string, string[]>;
  requires: Record<string, string[]>;
  databases: string[];
  alwaysRemoved: string[];
}

/** The fixed part of a route, up to its first parameter. */
function fixedPart(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const firstParameter = segments.findIndex((segment) => segment.startsWith(':'));
  return (firstParameter === -1 ? segments : segments.slice(0, firstParameter)).join('/');
}

function controllerRoutes(content: string): { base: string; routes: string[] } | undefined {
  const base = CONTROLLER_BASE.exec(content);
  if (base === null) return undefined;
  const routes = [...content.matchAll(HANDLER_PATH)].map((handler) =>
    [base[1] ?? '', fixedPart(handler[1] ?? '')].filter(Boolean).join('/'),
  );
  return { base: base[1] ?? '', routes: [...new Set(routes)] };
}

/** Every feature that cannot stay once `id` is gone: itself and what requires it. */
function goneWith(id: string, features: Record<string, OwnedFeature>): Set<string> {
  const gone = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [other, feature] of Object.entries(features)) {
      if (!gone.has(other) && feature.requires.some((needed) => gone.has(needed))) {
        gone.add(other);
        grew = true;
      }
    }
  }
  return gone;
}

function names(content: string, route: string): boolean {
  const literal = `${API_PREFIX}/${route}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${literal}(?![\\w-])`).test(content);
}

/**
 * The backend test files a project would keep after a feature is removed that
 * still call a route only that feature serves. `files` maps a repository path
 * to its text.
 */
export function featureRoutesLeftBehind(
  files: Map<string, string>,
  features: Record<string, OwnedFeature>,
  alwaysRemoved: string[],
): LeftBehind[] {
  const controllers = [...files]
    .filter(([file]) => file.startsWith(`${BACKEND_SOURCE}/`) && CONTROLLER_FILE.test(file))
    .flatMap(([file, content]) => {
      const found = controllerRoutes(content);
      return found ? [{ file, ...found }] : [];
    });
  const tests = [...files].filter(
    ([file]) => file.startsWith(`${BACKEND_TESTS}/`) && !matchesAnyGlob(file, alwaysRemoved),
  );
  const left: LeftBehind[] = [];

  for (const [id, feature] of Object.entries(features)) {
    const owns = (file: string): boolean => matchesAnyGlob(file, feature.files);
    const keptBases = new Set(
      controllers.filter(({ file }) => !owns(file)).map(({ base }) => base),
    );
    // A route equal to a base the project keeps a controller on is not this feature's alone.
    const routes = controllers
      .filter(({ file }) => owns(file))
      .flatMap(({ routes: served }) => served)
      .filter((route) => route !== '' && !keptBases.has(route));
    if (routes.length === 0) continue;

    const gone = goneWith(id, features);
    const removedWithIt = [...gone].flatMap((other) => features[other].files);
    for (const [file, content] of tests) {
      if (matchesAnyGlob(file, removedWithIt)) continue;
      const known = new Set(
        [...content.matchAll(MARKER_ID_LIST)].flatMap((marker) => marker[1].split(',')),
      );
      const kept = new Set([...known].filter((marked) => !gone.has(marked)));
      const remaining = stripFeatureMarkers(content, file, kept, known).content;
      for (const route of routes) {
        if (names(remaining, route)) left.push({ file, feature: id, route });
      }
    }
  }
  return left;
}

/** A selection a project can have: requirements kept, and one database at most. */
function possible(kept: Set<string>, owners: SpecOwners, known: Set<string>): boolean {
  const databases = owners.databases.filter((id) => kept.has(id));
  if (databases.length > 1) return false;
  const naming = owners.databases.filter((id) => known.has(id));
  if (databases.length === 0 && naming.length > 1) return false;
  return [...kept].every((id) =>
    (owners.requires[id] ?? []).every((needed) => !known.has(needed) || kept.has(needed)),
  );
}

/**
 * The backend specs some project would keep with every test call taken out by
 * markers, each with the ids that project keeps. Jest fails such a file: a
 * suite must contain at least one test.
 */
export function specsLeftWithoutTests(files: Map<string, string>, owners: SpecOwners): string[] {
  const left: string[] = [];
  for (const [file, content] of files) {
    if (!SPEC_FILE.test(file) || !TEST_CALL.test(content)) continue;
    if (matchesAnyGlob(file, owners.alwaysRemoved)) continue;
    const known = new Set(
      [...content.matchAll(MARKER_ID_LIST)].flatMap((marker) => marker[1].split(',')),
    );
    const required = Object.keys(owners.files).filter((id) =>
      matchesAnyGlob(file, owners.files[id]),
    );
    const free = [...known].filter((id) => !required.includes(id) && id !== DATABASE_CHOICE);
    for (let mask = 0; mask < 2 ** free.length; mask += 1) {
      const kept = new Set([...required, ...free.filter((_, bit) => mask & (2 ** bit))]);
      if (!possible(kept, owners, known)) continue;
      if (TEST_CALL.test(stripFeatureMarkers(content, file, kept, known).content)) continue;
      left.push(`${file} keeping ${[...kept].sort().join(',') || 'none'}`);
      break;
    }
  }
  return left;
}

function sourceFiles(prefix: string): [string, string][] {
  return readdirSync(join(REPO_ROOT, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
    return path.endsWith('.ts') ? [[path, readFileSync(join(REPO_ROOT, path), 'utf8')]] : [];
  });
}

const MAGIC_LINK = { files: ['backend/src/auth/magic-link/**'], requires: [] };
const CONTROLLER = [
  "@Controller('auth/magic-link')",
  'export class MagicLinkController {',
  "  @Post('request')",
  '  request() {}',
  "  @Get('status/:token')",
  '  status() {}',
  '}',
].join('\n');

function madeUp(tests: Record<string, string>, features: Record<string, OwnedFeature>) {
  return featureRoutesLeftBehind(
    new Map([
      ['backend/src/auth/magic-link/magic-link.controller.ts', CONTROLLER],
      [
        'backend/src/auth/auth.controller.ts',
        "@Controller('auth')\nclass A {\n  @Post('login')\n  login() {}\n}",
      ],
      ...Object.entries(tests),
    ]),
    features,
    ['backend/test/utils/browser/**'],
  ).map(({ file, feature, route }) => `${file} ${feature} ${route}`);
}

describe('backend tests that outlive the feature whose routes they call', () => {
  it('reports a kept suite that calls a route only the removed feature serves', () => {
    expect(
      madeUp(
        {
          'backend/test/auth/continuation.e2e-spec.ts':
            "await agent.post('/api/auth/magic-link/request');\nawait agent.get(`/api/auth/magic-link/status/${token}`);",
        },
        { 'magic-link': MAGIC_LINK },
      ),
    ).toEqual([
      'backend/test/auth/continuation.e2e-spec.ts magic-link auth/magic-link/request',
      'backend/test/auth/continuation.e2e-spec.ts magic-link auth/magic-link/status',
    ]);
  });

  it('accepts a suite the feature owns, one every project loses, and marked lines', () => {
    const call = "await agent.post('/api/auth/magic-link/request');";
    expect(
      madeUp(
        {
          'backend/test/auth/owned.e2e-spec.ts': call,
          'backend/test/utils/browser/server.ts': call,
          'backend/test/auth/line.e2e-spec.ts': `${call} // feature:magic-link`,
          'backend/test/auth/block.e2e-spec.ts': `// feature:magic-link:start\n${call}\n// feature:magic-link:end\nawait agent.post('/api/auth/login');`,
          'backend/test/auth/other.e2e-spec.ts':
            "await agent.post('/api/auth/magic-link-like/request');",
        },
        {
          'magic-link': {
            files: [...MAGIC_LINK.files, 'backend/test/auth/owned.e2e-spec.ts'],
            requires: [],
          },
        },
      ),
    ).toEqual([]);
  });

  it('counts a line marked for a feature that needs the removed one as gone, and no other', () => {
    const call = "await agent.post('/api/auth/magic-link/request');";
    expect(
      madeUp(
        {
          'backend/test/auth/needs.e2e-spec.ts': `${call} // feature:continuation`,
          'backend/test/auth/unrelated.e2e-spec.ts': `${call} // feature:passkeys`,
        },
        {
          'magic-link': MAGIC_LINK,
          continuation: { files: [], requires: ['magic-link'] },
          passkeys: { files: [], requires: [] },
        },
      ),
    ).toEqual(['backend/test/auth/unrelated.e2e-spec.ts magic-link auth/magic-link/request']);
  });

  it('finds none in this repository', async () => {
    const manifest = await loadManifest(REPO_ROOT);
    const files = new Map([...sourceFiles(BACKEND_SOURCE), ...sourceFiles(BACKEND_TESTS)]);
    const features = Object.fromEntries(
      Object.entries(manifest.features).map(([id, feature]) => [
        id,
        { files: feature.files, requires: feature.requires },
      ]),
    );

    expect(featureRoutesLeftBehind(files, features, manifest.core.alwaysRemoveFiles)).toEqual([]);
  });
});

const NO_OWNERS: SpecOwners = { files: {}, requires: {}, databases: [], alwaysRemoved: [] };
const CASE = "it('refuses', () => undefined);";

describe('backend specs that keep no test once markers are taken out', () => {
  it('reports a spec wrapped whole in a feature it is not listed under', () => {
    const wrapped = `// feature:magic-link:start\n${CASE}\n// feature:magic-link:end\n`;

    expect(
      specsLeftWithoutTests(new Map([['backend/test/auth/a.e2e-spec.ts', wrapped]]), NO_OWNERS),
    ).toEqual(['backend/test/auth/a.e2e-spec.ts keeping none']);
    expect(
      specsLeftWithoutTests(new Map([['backend/test/auth/a.e2e-spec.ts', wrapped]]), {
        ...NO_OWNERS,
        files: { 'magic-link': ['backend/test/auth/a.e2e-spec.ts'] },
      }),
    ).toEqual([]);
  });

  it('reports the selection that empties a spec through nested blocks, and no other', () => {
    const nested = `// feature:email-password,magic-link:start\n${CASE}\n// feature:email-password,magic-link:end\n`;
    const owners = { ...NO_OWNERS, files: { passkeys: ['backend/test/auth/b.e2e-spec.ts'] } };

    expect(
      specsLeftWithoutTests(new Map([['backend/test/auth/b.e2e-spec.ts', nested]]), owners),
    ).toEqual(['backend/test/auth/b.e2e-spec.ts keeping passkeys']);
    expect(
      specsLeftWithoutTests(
        new Map([['backend/test/auth/b.e2e-spec.ts', `${nested}${CASE}\n`]]),
        owners,
      ),
    ).toEqual([]);
  });

  it('finds none in this repository', async () => {
    const manifest = await loadManifest(REPO_ROOT);
    const files = new Map([...sourceFiles(BACKEND_SOURCE), ...sourceFiles(BACKEND_TESTS)]);
    const dimensions = [
      manifest.features,
      manifest.options,
      manifest.databases,
      manifest.targets,
      manifest.shared,
    ];

    expect(
      specsLeftWithoutTests(files, {
        files: Object.fromEntries(
          dimensions.flatMap((owners) =>
            Object.entries(owners).map(([id, owner]) => [id, owner.files]),
          ),
        ),
        requires: Object.fromEntries(
          Object.entries(manifest.features).map(([id, feature]) => [id, feature.requires]),
        ),
        databases: Object.keys(manifest.databases),
        alwaysRemoved: manifest.core.alwaysRemoveFiles,
      }),
    ).toEqual([]);
  });
});
