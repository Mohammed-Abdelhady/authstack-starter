import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../../src/manifest/load.js';
import { defaultOwnership, resolveOwnership } from '../../src/manifest/ownership.js';
import { resolvePlan } from '../../src/manifest/plan.js';
import { validateManifest } from '../../src/manifest/validate.js';
import { TARGETS_MANIFEST } from '../support/targets-fixture.js';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

function owned(targets: string[]): ReturnType<typeof resolveOwnership> {
  return resolveOwnership(TARGETS_MANIFEST, resolvePlan(TARGETS_MANIFEST, { targets }));
}

describe('resolveOwnership', () => {
  it('removes every other client and the shared module for the web app alone', () => {
    expect(owned(['web'])).toEqual({
      removedFiles: [
        'mobile/expo/**',
        'mobile/cli/**',
        'kiosk/**',
        'kiosk.env.example',
        'mobile/auth/**',
      ],
      keptIds: ['web'],
      knownIds: ['web', 'native-expo', 'native-cli', 'kiosk', 'native-core'],
    });
  });

  it('keeps the mobile app and what it shares, and still removes the planned app', () => {
    expect(owned(['web', 'native-expo'])).toEqual({
      removedFiles: ['mobile/cli/**', 'kiosk/**', 'kiosk.env.example'],
      keptIds: ['web', 'native-expo', 'native-core'],
      knownIds: ['web', 'native-expo', 'native-cli', 'kiosk', 'native-core'],
    });
  });

  it('keeps the web app for a mobile app chosen alone, because it signs in there', () => {
    const ownership = owned(['native-expo']);

    expect(ownership.removedFiles).toEqual(['mobile/cli/**', 'kiosk/**', 'kiosk.env.example']);
    expect(ownership.keptIds).toEqual(['web', 'native-expo', 'native-core']);
  });

  it('removes the web app for a client that does not sign in through it', () => {
    const ownership = owned(['kiosk']);

    expect(ownership.removedFiles).toEqual([
      'frontend/**',
      'mobile/expo/**',
      'mobile/cli/**',
      'mobile/auth/**',
    ]);
    expect(ownership.keptIds).toEqual(['kiosk']);
  });

  it('takes the manifest default clients when a run names none', () => {
    expect(defaultOwnership(TARGETS_MANIFEST)).toEqual(owned(['web']));
  });
});

describe('ownership in the real manifest', () => {
  it('leaves nothing of the mobile folder in a web project', async () => {
    const manifest = await loadManifest(REPO_ROOT);
    const ownership = resolveOwnership(manifest, resolvePlan(manifest, { targets: ['web'] }));

    expect(ownership.removedFiles).toEqual([
      'mobile/expo/**',
      'mobile/cli/**',
      'mobile/adapters/**',
      'mobile/auth/**',
      'mobile/device-key/**',
      'mobile/metro/**',
      'mobile/ui/**',
    ]);
    expect(ownership.keptIds).toEqual(['web']);
  });

  it.each([[['web', 'native-expo']], [['native-expo']]])(
    'removes only the bare app for %j',
    async (targets) => {
      const manifest = await loadManifest(REPO_ROOT);
      const ownership = resolveOwnership(manifest, resolvePlan(manifest, { targets }));

      expect(ownership.removedFiles).toEqual(['mobile/cli/**']);
      expect(ownership.keptIds).toEqual(['web', 'native-expo', 'native-core']);
    },
  );
});

describe('ownership rules at load', () => {
  const base = {
    version: 2,
    databases: {
      mongodb: { label: 'MongoDB', default: true, files: [], envVars: [] },
    },
    features: {},
    core: { alwaysRemoveFiles: [] },
  };
  const web = { label: 'Web', default: true, files: [], workspaces: [], envFiles: [] };

  it('accepts a planned client that owns files', () => {
    const manifest = validateManifest({
      ...base,
      targets: {
        web,
        later: {
          label: 'Later',
          default: false,
          status: 'planned',
          files: ['later/**'],
          workspaces: ['later'],
        },
      },
    });

    expect(manifest.targets.later.files).toEqual(['later/**']);
  });

  it('refuses a workspace the owner files do not cover', () => {
    expect(() =>
      validateManifest({
        ...base,
        targets: { web },
        shared: { core: { files: ['mobile/auth/**'], workspaces: ['mobile/ui'] } },
      }),
    ).toThrow('shared.core.workspaces names "mobile/ui", which its files do not cover');
  });

  it('refuses a client workspace outside the client files', () => {
    expect(() =>
      validateManifest({
        ...base,
        targets: { web: { ...web, files: ['frontend/**'], workspaces: ['admin'] } },
      }),
    ).toThrow('targets.web.workspaces names "admin", which its files do not cover');
  });
});
