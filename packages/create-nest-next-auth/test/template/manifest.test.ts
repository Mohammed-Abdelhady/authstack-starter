import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../../src/manifest/load.js';
import {
  availableFeatures,
  defaultFeatureIds,
  resolveSelection,
} from '../../src/manifest/select.js';
import { ManifestError, validateManifest } from '../../src/manifest/validate.js';
import { FEATURE_KIND_ORDER } from '../../src/constants/index.js';
import { matchesGlob } from '../../src/utils/glob.js';
import { SKIPPED_SCAN_DIRS } from '../support/reference-content.js';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/**
 * Repository files as root-relative posix paths. The installer's own `packages/`
 * workspace is left out by path, so a concurrent packed-build test that rewrites
 * `packages/create-nest-next-auth/template/` cannot race this walk.
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

/** Checks one dimension's paths: exact paths must exist, globs must match. */
function expectDimensionPathsExist(
  where: string,
  entries: Record<string, { files: string[]; docs?: string[] }>,
): void {
  const present = repoFiles();
  for (const [id, entry] of Object.entries(entries)) {
    for (const path of [...entry.files, ...(entry.docs ?? [])]) {
      if (path.includes('*')) {
        expect(
          present.some((file) => matchesGlob(file, path)),
          `${where}.${id} glob ${path} matches no file`,
        ).toBe(true);
        continue;
      }
      expect(
        existsSync(join(REPO_ROOT, path)),
        `${where}.${id} lists ${path}, which does not exist`,
      ).toBe(true);
    }
  }
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
  it('accepts a minimal manifest', () => {
    const manifest = validateManifest({
      features: { alpha: feature() },
      core: { alwaysRemoveFiles: [] },
    });
    expect(manifest.features.alpha.status).toBe('available');
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      validateManifest({
        features: { a: feature({ kind: 'sms' }) },
        core: { alwaysRemoveFiles: [] },
      }),
    ).toThrow(ManifestError);
  });

  it('rejects a missing label', () => {
    expect(() =>
      validateManifest({
        features: { a: feature({ label: '' }) },
        core: { alwaysRemoveFiles: [] },
      }),
    ).toThrow(/label must be a non-empty string/);
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

  it('reports every problem at once', () => {
    try {
      validateManifest({
        features: { Bad_Id: feature({ kind: 'sms', default: 'yes' }) },
        core: {},
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ManifestError);
      expect((error as ManifestError).problems.length).toBeGreaterThan(2);
    }
  });
});

describe('the repository manifest', () => {
  it('is valid', async () => {
    const manifest = await loadManifest(REPO_ROOT);
    expect(Object.keys(manifest.features).length).toBeGreaterThan(4);
  });

  it('preselects email and password with the three first-party providers', async () => {
    const manifest = await loadManifest(REPO_ROOT);
    expect(defaultFeatureIds(manifest)).toEqual(['email-password', 'google', 'github', 'facebook']);
  });

  it('keeps hidden features out of the prompt and off the defaults', async () => {
    const manifest = await loadManifest(REPO_ROOT);
    const hidden = availableFeatures(manifest).filter(({ feature }) => feature.kind === 'hidden');

    expect(hidden.map(({ id }) => id)).toEqual(['oauth-core']);
    for (const { id, feature } of hidden) {
      expect(feature.default, `${id} is hidden and cannot be a default`).toBe(false);
      expect(FEATURE_KIND_ORDER).not.toContain(feature.kind);
    }
  });

  it('gives every planned feature an empty file list', async () => {
    const manifest = await loadManifest(REPO_ROOT);
    for (const [id, entry] of Object.entries(manifest.features)) {
      if (entry.status !== 'planned') continue;
      expect(entry.files, `${id} is planned but claims files`).toEqual([]);
    }
  });

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

  it('pulls in requirements and leaves ids outside the selection out', async () => {
    const manifest = await loadManifest(REPO_ROOT);
    const selection = resolveSelection(manifest, ['google', 'apple']);

    expect(selection.selected).toEqual(['oauth-core', 'google', 'apple']);
  });

  it('claims every file that exists, so a delete list is never stale', async () => {
    const manifest = await loadManifest(REPO_ROOT);

    expectDimensionPathsExist('features', manifest.features);
  });

  it('claims every option file that exists', async () => {
    const manifest = await loadManifest(REPO_ROOT);

    expectDimensionPathsExist('options', manifest.options);
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
