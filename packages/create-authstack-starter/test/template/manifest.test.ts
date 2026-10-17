import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../../src/manifest/load.js';
import { ManifestError, validateManifest } from '../../src/manifest/validate.js';
import { matchesGlob } from '../../src/utils/glob.js';
import { SKIPPED_SCAN_DIRS } from '../support/reference-content.js';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/**
 * Repository files as root-relative posix paths. The installer's own `packages/`
 * workspace is left out by path, so a concurrent packed-build test that rewrites
 * `packages/create-authstack-starter/template/` cannot race this walk.
 */
function repoFiles(prefix = ''): string[] {
  const directory = join(REPO_ROOT, prefix);
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (relative === 'packages' || SKIPPED_SCAN_DIRS.has(entry.name)) continue;
      found.push(...repoFiles(relative));
      continue;
    }
    if (entry.isFile()) found.push(relative);
  }
  return found;
}

function feature(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    label: 'Alpha',
    description: 'Sign in with Alpha.',
    kind: 'oauth',
    default: true,
    files: [],
    envVars: [],
    requires: [],
    docs: [],
    ...overrides,
  };
}

describe('validateManifest', () => {
  it('rejects an unknown kind', () => {
    expect(() =>
      validateManifest({
        features: { a: feature({ kind: 'sms' }) },
        core: { alwaysRemoveFiles: [] },
      }),
    ).toThrow(ManifestError);
  });

  it('rejects paths that escape the project', () => {
    expect(() =>
      validateManifest({
        features: { a: feature({ files: ['../outside.ts'] }) },
        core: { alwaysRemoveFiles: [] },
      }),
    ).toThrow(/relative posix path/);
  });

  it('rejects a requirement that does not exist', () => {
    expect(() =>
      validateManifest({
        features: { a: feature({ requires: ['ghost'] }) },
        core: { alwaysRemoveFiles: [] },
      }),
    ).toThrow(/does not exist/);
  });

  it('rejects an available feature requiring a planned one', () => {
    expect(() =>
      validateManifest({
        features: {
          a: feature({ requires: ['b'] }),
          b: feature({ status: 'planned', default: false }),
        },
        core: { alwaysRemoveFiles: [] },
      }),
    ).toThrow(/requires planned feature/);
  });
});

describe('the repository manifest', () => {
  it('never lists the same file under two features', async () => {
    const manifest = await loadManifest(REPO_ROOT);
    const seen = new Map<string, string>();
    for (const [id, entry] of Object.entries(manifest.features)) {
      for (const path of [...entry.files, ...entry.docs]) {
        expect(seen.has(path), `${path} is claimed by ${seen.get(path)} and ${id}`).toBe(false);
        seen.set(path, id);
      }
    }
  });

  it('gives every option file a single owner once globs are expanded', async () => {
    const manifest = await loadManifest(REPO_ROOT);
    const present = repoFiles();

    for (const file of present) {
      const owners = Object.entries(manifest.options)
        .filter(([, option]) =>
          [...option.files, ...option.docs].some((path) =>
            path.includes('*') ? matchesGlob(file, path) : path === file,
          ),
        )
        .map(([id]) => id);
      expect(owners.length, `${file} is claimed by ${owners.join(', ')}`).toBeLessThanOrEqual(1);
    }
  });

  it('gives every Docker file a docker or production owner once globs are expanded', async () => {
    const manifest = await loadManifest(REPO_ROOT);
    const owners = ['docker', 'production'].map((id) => [id, manifest.options[id]] as const);
    const present = repoFiles().filter(
      (file) =>
        /(^|\/)Dockerfile$/.test(file) ||
        /(^|\/)\.dockerignore$/.test(file) ||
        /(^|\/)docker-compose[^/]*\.ya?ml$/.test(file),
    );
    expect(present.length).toBeGreaterThan(0);

    for (const file of present) {
      const claimed = owners.some(([, option]) =>
        [...option.files, ...option.docs].some((path) =>
          path.includes('*') ? matchesGlob(file, path) : path === file,
        ),
      );
      expect(claimed, `${file} has no docker or production owner`).toBe(true);
    }
  });
});
