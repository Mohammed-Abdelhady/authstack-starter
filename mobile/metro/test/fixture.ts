import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

type Dependencies = Record<string, string>;

export interface FixturePackage {
  name: string;
  dependencies?: Dependencies;
  devDependencies?: Dependencies;
  peerDependencies?: Dependencies;
  /** Dependencies left without a link, as before an install. */
  unlinked?: string[];
}

const created: string[] = [];

/** Writes a pnpm workspace to disk and links packages the way an install does. */
export function makeWorkspace(packages: Record<string, FixturePackage>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'metro-workspace-')));
  created.push(root);
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: [mobile/*, shared/*]\n');
  mkdirSync(join(root, 'node_modules'));
  const folders = new Map(Object.entries(packages).map(([folder, { name }]) => [name, folder]));
  for (const [folder, { unlinked = [], ...manifest }] of Object.entries(packages)) {
    mkdirSync(join(root, folder), { recursive: true });
    writeFileSync(join(root, folder, 'package.json'), JSON.stringify(manifest));
    const declared = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    };
    for (const name of Object.keys(declared)) {
      const target = folders.get(name);
      if (target === undefined || unlinked.includes(name)) continue;
      const link = join(root, folder, 'node_modules', name);
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(join(root, target), link, 'dir');
    }
  }
  return root;
}

export function removeWorkspaces(): void {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
}

/** A shell, the engine it uses, and the neighbours it must never reach. */
export const REPOSITORY_LIKE: Record<string, FixturePackage> = {
  'mobile/expo': {
    name: '@app/mobile-expo',
    dependencies: {
      '@app/native-adapters': 'workspace:*',
      '@app/native-auth': 'workspace:*',
      '@app/sdk': 'workspace:*',
      react: '19.2.3',
    },
    devDependencies: { '@app/metro-config': 'workspace:*' },
  },
  // feature:native-cli:start
  'mobile/cli': {
    name: '@app/mobile-cli',
    dependencies: {
      '@app/native-adapters': 'workspace:*',
      '@app/native-auth': 'workspace:*',
      '@app/sdk': 'workspace:*',
      react: '19.2.3',
    },
    devDependencies: { '@app/metro-config': 'workspace:*' },
  },
  // feature:native-cli:end
  'mobile/adapters': {
    name: '@app/native-adapters',
    dependencies: { '@app/native-auth': 'workspace:*', '@app/sdk': 'workspace:*' },
  },
  'mobile/auth': {
    name: '@app/native-auth',
    dependencies: { '@app/sdk': 'workspace:*' },
    devDependencies: { '@app/lint-rules': 'workspace:*' },
  },
  'mobile/metro': { name: '@app/metro-config' },
  'shared/sdk': { name: '@app/sdk', dependencies: { '@app/core': 'workspace:^' } },
  'shared/core': { name: '@app/core' },
  'shared/lint-rules': { name: '@app/lint-rules' },
  backend: { name: 'backend', devDependencies: { '@app/sdk': 'workspace:*' } },
  frontend: { name: 'frontend', dependencies: { '@app/sdk': 'workspace:*', react: '19.3.0' } },
  'packages/create-nest-next-auth': { name: 'create-nest-next-auth' },
};
