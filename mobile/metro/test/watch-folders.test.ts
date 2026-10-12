import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { withWorkspace, workspaceDependencyFolders } from '../src/index.cjs';
import { type FixturePackage, makeWorkspace, removeWorkspaces, REPOSITORY_LIKE } from './fixture';

const REPOSITORY = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');

afterEach(removeWorkspaces);

/** Watch folders as paths relative to the workspace root. */
function watched(root: string, shell = 'mobile/expo', base = {}): string[] {
  const { watchFolders } = withWorkspace(base, join(root, shell), { workspaceRoot: root });
  return watchFolders.map((folder) =>
    folder.startsWith(`${root}/`) ? folder.slice(root.length + 1) : folder,
  );
}

it('watches the store, the shell and every workspace package the shell reaches', () => {
  const root = makeWorkspace(REPOSITORY_LIKE);

  expect(watched(root)).toEqual([
    'node_modules',
    'mobile/expo',
    'mobile/adapters',
    'mobile/auth',
    'mobile/metro',
    'shared/core',
    'shared/sdk',
  ]);
});

it('leaves out workspaces the shell does not depend on', () => {
  const folders = watched(makeWorkspace(REPOSITORY_LIKE));

  expect(
    ['backend', 'frontend', 'packages/create-nest-next-auth'].filter((folder) =>
      folders.includes(folder),
    ),
  ).toEqual([]);
});

it('leaves out the development tools of a dependency', () => {
  expect(watched(makeWorkspace(REPOSITORY_LIKE))).not.toContain('shared/lint-rules');
});

it('watches a workspace package as soon as the shell depends on it', () => {
  const shell = REPOSITORY_LIKE['mobile/expo'];
  const root = makeWorkspace({
    ...REPOSITORY_LIKE,
    'mobile/expo': { ...shell, dependencies: { ...shell.dependencies, '@app/ui': 'workspace:*' } },
    'mobile/ui': { name: '@app/ui', peerDependencies: { '@app/theme': 'workspace:*' } },
    'shared/theme': { name: '@app/theme' },
  });

  expect(watched(root)).toEqual([
    'node_modules',
    'mobile/expo',
    'mobile/adapters',
    'mobile/auth',
    'mobile/metro',
    'mobile/ui',
    'shared/core',
    'shared/sdk',
    'shared/theme',
  ]);
});

it('ignores a package of the same name that is installed from the registry', () => {
  const packages: Record<string, FixturePackage> = {
    'mobile/expo': { name: '@app/mobile-expo', dependencies: { '@app/sdk': '1.4.0' } },
    'shared/sdk': { name: '@app/sdk' },
  };

  expect(watched(makeWorkspace(packages))).toEqual(['node_modules', 'mobile/expo']);
});

it('ends when two workspace packages depend on each other', () => {
  const root = makeWorkspace({
    'mobile/expo': { name: '@app/mobile-expo', dependencies: { '@app/a': 'workspace:*' } },
    'shared/a': { name: '@app/a', dependencies: { '@app/b': 'workspace:*' } },
    'shared/b': {
      name: '@app/b',
      dependencies: { '@app/a': 'workspace:*', '@app/mobile-expo': 'workspace:*' },
    },
  });

  expect(watched(root)).toEqual(['node_modules', 'mobile/expo', 'shared/a', 'shared/b']);
});

it('says which package is missing when the workspace was not installed', () => {
  const root = makeWorkspace({
    'mobile/expo': {
      name: '@app/mobile-expo',
      dependencies: { '@app/sdk': 'workspace:*' },
      unlinked: ['@app/sdk'],
    },
    'shared/sdk': { name: '@app/sdk' },
  });

  expect(() => workspaceDependencyFolders(join(root, 'mobile/expo'))).toThrow(
    /@app\/sdk is not linked into .*mobile\/expo\. Run pnpm install first\./,
  );
});

it('drops the base folders inside the workspace and keeps the ones outside it', () => {
  const root = makeWorkspace(REPOSITORY_LIKE);
  const base = {
    watchFolders: [
      join(root, 'node_modules'),
      join(root, 'backend'),
      join(root, 'frontend'),
      join(root, 'mobile/auth'),
      root,
      '/elsewhere/assets',
    ],
  };
  const snapshot = structuredClone(base);

  expect(watched(root, 'mobile/expo', base)).toEqual([
    '/elsewhere/assets',
    'node_modules',
    'mobile/expo',
    'mobile/adapters',
    'mobile/auth',
    'mobile/metro',
    'shared/core',
    'shared/sdk',
  ]);
  expect(base).toEqual(snapshot);
});

it.each([
  [
    'mobile/expo',
    [
      'node_modules',
      'mobile/expo',
      'mobile/adapters',
      'mobile/auth',
      'mobile/device-key',
      'mobile/metro',
      'mobile/ui',
      'shared/core',
      'shared/sdk',
    ],
  ],
  // feature:native-cli:start
  [
    'mobile/cli',
    [
      'node_modules',
      'mobile/cli',
      'mobile/adapters',
      'mobile/auth',
      'mobile/device-key',
      'mobile/metro',
      'mobile/ui',
      'shared/core',
      'shared/sdk',
    ],
  ],
  // feature:native-cli:end
])('gives %s in this repository its real reach', (shell, expected) => {
  expect(watched(REPOSITORY, shell)).toEqual(expected);
});
