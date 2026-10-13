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

interface OwnedFeature {
  files: string[];
  requires: string[];
}

interface LeftBehind {
  file: string;
  feature: string;
  route: string;
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
