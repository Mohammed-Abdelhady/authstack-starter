import { describe, expect, it } from 'vitest';
import { manifestPathProblems, validateManifestPaths } from '../../src/manifest/validate-paths.js';
import { ManifestError, validateManifest } from '../../src/manifest/validate.js';
import type { Manifest } from '../../src/types.js';

const TRACKED = [
  'frontend/package.json',
  'frontend/src/app.tsx',
  'mobile/auth/package.json',
  'mobile/auth/src/index.ts',
  'mobile/notes/readme.md',
  'backend/migrations/001.js',
  'docker-compose.yml',
  'backend/src/auth/alpha.strategy.ts',
];

function manifest(overrides: Record<string, unknown> = {}): Manifest {
  return validateManifest({
    version: 2,
    targets: {
      web: {
        label: 'Web',
        default: true,
        files: ['frontend/**'],
        workspaces: ['frontend'],
        envFiles: [],
      },
    },
    shared: { core: { files: ['mobile/auth/**'], workspaces: ['mobile/auth'] } },
    databases: {
      mongodb: {
        label: 'MongoDB',
        default: true,
        files: ['backend/migrations/**'],
        envVars: [],
      },
    },
    options: {
      docker: {
        label: 'Docker',
        default: true,
        files: ['docker-compose.yml'],
        docs: [],
        catalogueKeys: [],
      },
    },
    presets: {},
    features: {
      alpha: {
        label: 'Alpha',
        description: 'Alpha.',
        kind: 'oauth',
        default: false,
        files: ['backend/src/auth/alpha.strategy.ts'],
        envVars: [],
        requires: [],
        docs: [],
      },
    },
    core: { alwaysRemoveFiles: ['never/there/**'] },
    ...overrides,
  });
}

describe('validateManifestPaths', () => {
  it('accepts a manifest whose every glob, path and workspace is tracked', () => {
    expect(manifestPathProblems(manifest(), TRACKED)).toEqual([]);
    expect(() => validateManifestPaths(manifest(), TRACKED)).not.toThrow();
  });

  it('rejects a glob that matches no tracked file', () => {
    const stale = manifest({
      shared: { core: { files: ['mobile/auth/**', 'mobile/device-key/**'], workspaces: [] } },
    });

    expect(manifestPathProblems(stale, TRACKED)).toEqual([
      'shared.core.files names "mobile/device-key/**", which matches no tracked file',
    ]);
    expect(() => validateManifestPaths(stale, TRACKED)).toThrow(ManifestError);
  });

  it('rejects an exact path that is not tracked', () => {
    const stale = manifest({
      options: {
        docker: {
          label: 'Docker',
          default: true,
          files: ['docker-compose.yml', 'docker-compose.override.yml'],
          docs: [],
          catalogueKeys: [],
        },
      },
    });

    expect(manifestPathProblems(stale, TRACKED)).toEqual([
      'options.docker.files names "docker-compose.override.yml", which matches no tracked file',
    ]);
  });

  it('rejects a workspace folder that holds files but no package.json', () => {
    const stale = manifest({
      shared: { core: { files: ['mobile/notes/**'], workspaces: ['mobile/notes'] } },
    });

    expect(manifestPathProblems(stale, TRACKED)).toEqual([
      'shared.core.workspaces names "mobile/notes", which has no tracked package.json',
    ]);
  });

  it('rejects a client env file that is not tracked', () => {
    const stale = manifest({
      targets: {
        web: {
          label: 'Web',
          default: true,
          files: ['frontend/**'],
          workspaces: ['frontend'],
          envFiles: ['frontend/package.json', 'frontend/.env.example'],
        },
      },
    });

    expect(manifestPathProblems(stale, TRACKED)).toEqual([
      'targets.web.envFiles names "frontend/.env.example", which matches no tracked file',
    ]);
  });

  it('reports every dimension at once against an empty tree', () => {
    expect(manifestPathProblems(manifest(), [])).toEqual([
      'targets.web.files names "frontend/**", which matches no tracked file',
      'targets.web.workspaces names "frontend", which has no tracked package.json',
      'shared.core.files names "mobile/auth/**", which matches no tracked file',
      'shared.core.workspaces names "mobile/auth", which has no tracked package.json',
      'databases.mongodb.files names "backend/migrations/**", which matches no tracked file',
      'options.docker.files names "docker-compose.yml", which matches no tracked file',
      'features.alpha.files names "backend/src/auth/alpha.strategy.ts", which matches no tracked file',
    ]);
  });
});
