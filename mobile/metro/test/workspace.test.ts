import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { findWorkspaceRoot, withWorkspace } from '../src/index.cjs';
import { makeWorkspace, removeWorkspaces } from './fixture';

const REPOSITORY = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const LONE_SHELL = { 'mobile/expo': { name: '@app/mobile-expo' } };

afterEach(removeWorkspaces);

it('finds the workspace root above a nested shell folder', () => {
  const root = makeWorkspace(LONE_SHELL);
  mkdirSync(join(root, 'mobile/expo/src'));

  expect(findWorkspaceRoot(join(root, 'mobile/expo/src'))).toBe(root);
  expect(findWorkspaceRoot(root)).toBe(root);
});

it('stops at the nearest workspace file, not an outer one', () => {
  const outer = makeWorkspace(LONE_SHELL);
  const inner = join(outer, 'vendor/project');
  mkdirSync(join(inner, 'mobile/expo'), { recursive: true });
  writeFileSync(join(inner, 'pnpm-workspace.yaml'), 'packages: [mobile/*]\n');

  expect(findWorkspaceRoot(join(inner, 'mobile/expo'))).toBe(inner);
});

it('refuses a folder that is in no workspace', () => {
  const root = makeWorkspace(LONE_SHELL);
  const lonely = join(root, '..');

  expect(() => findWorkspaceRoot(lonely)).toThrow(/No pnpm-workspace\.yaml was found above/);
});

it('resolves each shell in this repository to the repository root', () => {
  expect(findWorkspaceRoot(join(REPOSITORY, 'mobile/expo'))).toBe(REPOSITORY);
  expect(findWorkspaceRoot(join(REPOSITORY, 'mobile/cli'))).toBe(REPOSITORY); // feature:native-cli
});

it('looks for packages in the shell before the root and keeps other lookup folders', () => {
  const root = makeWorkspace(LONE_SHELL);
  const shell = join(root, 'mobile/expo');
  const base = {
    projectRoot: shell,
    resolver: {
      nodeModulesPaths: [join(root, 'node_modules'), '/extra/node_modules'],
      sourceExts: ['ts', 'tsx'],
    },
    transformer: { minifierPath: 'metro-minify-terser' },
  };
  const snapshot = structuredClone(base);

  const config = withWorkspace(base, shell, { workspaceRoot: root });

  expect(config.resolver.nodeModulesPaths).toEqual([
    join(root, 'mobile/expo/node_modules'),
    join(root, 'node_modules'),
    '/extra/node_modules',
  ]);
  expect(config.resolver.sourceExts).toEqual(['ts', 'tsx']);
  expect(config.transformer).toEqual({ minifierPath: 'metro-minify-terser' });
  expect(config.projectRoot).toBe(shell);
  expect(base).toEqual(snapshot);
});

it('fills in a configuration that has no watch folders or resolver', () => {
  const root = makeWorkspace(LONE_SHELL);

  const config = withWorkspace({}, join(root, 'mobile/expo'), { workspaceRoot: root });

  expect(config.watchFolders).toEqual([join(root, 'node_modules'), join(root, 'mobile/expo')]);
  expect(config.resolver.nodeModulesPaths).toEqual([
    join(root, 'mobile/expo/node_modules'),
    join(root, 'node_modules'),
  ]);
});

it('follows links and package exports, and keeps the walk up the tree', () => {
  const root = makeWorkspace(LONE_SHELL);
  const config = withWorkspace(
    {
      resolver: {
        unstable_enableSymlinks: false,
        unstable_enablePackageExports: false,
        disableHierarchicalLookup: true,
      },
    },
    join(root, 'mobile/expo'),
    { workspaceRoot: root },
  );

  expect({
    symlinks: config.resolver.unstable_enableSymlinks,
    exports: config.resolver.unstable_enablePackageExports,
    flatLookupOnly: config.resolver.disableHierarchicalLookup,
  }).toEqual({ symlinks: true, exports: true, flatLookupOnly: false });
});

it('finds the workspace root itself when none is passed', () => {
  const root = makeWorkspace(LONE_SHELL);

  const config = withWorkspace({}, join(root, 'mobile/expo'));

  expect(config.watchFolders).toEqual([join(root, 'node_modules'), join(root, 'mobile/expo')]);
});
