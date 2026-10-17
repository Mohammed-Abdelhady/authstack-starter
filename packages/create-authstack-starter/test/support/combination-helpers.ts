import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parse, stringify } from 'yaml';
import { isRecord } from '../../src/manifest/read.js';
import { type CommandResult, runTool } from './run-tool.js';
import { assertWorkspaceEdgesResolve } from './workspace-assertions.js';

export { BUILD_TIMEOUT, type CommandResult, runTool } from './run-tool.js';

export const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));
export const REPO_ROOT = dirname(dirname(PACKAGE_DIR));
export const CLI = join(PACKAGE_DIR, 'dist', 'index.js');

const ROOT_MODULES = 'node_modules';
const SHARED_SCOPE = '@app';
const SHARED_DIRECTORY = 'shared';

/** Workspaces whose node_modules the generated project borrows. */
const LINKED_MODULES = [
  'backend/node_modules',
  'frontend/node_modules',
  'shared/core/node_modules',
  'shared/sdk/node_modules',
];

/** Yield while child tools run so Vitest can process worker messages. */
export function buildCli(): Promise<CommandResult> {
  return runTool('pnpm', ['run', 'build'], { cwd: PACKAGE_DIR });
}

export function scaffold(
  target: string,
  features?: string[],
  flags: string[] = [],
  executable = CLI,
): Promise<CommandResult> {
  const args = [executable, target, '--yes'];
  if (features) args.push('--features', features.join(','));
  args.push(...flags, '--no-install', '--no-git');
  return scaffoldAndCheck(target, args);
}

async function scaffoldAndCheck(target: string, args: string[]): Promise<CommandResult> {
  const result = await runTool(process.execPath, args);
  if (result.ok) assertWorkspaceEdgesResolve(target);
  return result;
}

/** Updates the pruned graph, then verifies it with lifecycle scripts enabled. */
export async function installProject(
  project: string,
  store: string,
  signal?: AbortSignal,
): Promise<CommandResult> {
  const workspaceFile = join(project, 'pnpm-workspace.yaml');
  const workspace: unknown = parse(await readFile(workspaceFile, 'utf8'));
  if (!isRecord(workspace)) throw new Error('Invalid generated pnpm workspace configuration.');
  // pnpm run verifies the dependency layout too, so later gates need the same store.
  await writeFile(workspaceFile, stringify({ ...workspace, storeDir: store }));
  const options = {
    cwd: project,
    env: { MONGOMS_DOWNLOAD_DIR: join(dirname(store), 'mongo-binaries') },
    signal,
  };
  const update = await runTool(
    'pnpm',
    ['install', '--lockfile-only', '--store-dir', store],
    options,
  );
  if (!update.ok) return update;
  return runTool('pnpm', ['install', '--frozen-lockfile', '--store-dir', store], options);
}

/** Installs exactly what the lockfile the installer wrote names, with nothing resolved again. */
export async function installFrozen(project: string, store: string): Promise<CommandResult> {
  const workspaceFile = join(project, 'pnpm-workspace.yaml');
  const workspace: unknown = parse(await readFile(workspaceFile, 'utf8'));
  if (!isRecord(workspace)) throw new Error('Invalid generated pnpm workspace configuration.');
  // pnpm run verifies the dependency layout too, so later gates need the same store.
  await writeFile(workspaceFile, stringify({ ...workspace, storeDir: store }));
  return runTool('pnpm', ['install', '--frozen-lockfile', '--store-dir', store], {
    cwd: project,
    env: { MONGOMS_DOWNLOAD_DIR: join(dirname(store), 'mongo-binaries') },
  });
}

export function installFromWarmStore(project: string, store: string): Promise<CommandResult> {
  return runTool('pnpm', ['install', '--offline', '--frozen-lockfile', '--store-dir', store], {
    cwd: project,
    env: {
      MONGOMS_DOWNLOAD_DIR: join(dirname(store), 'mongo-binaries'),
      MONGOMS_RUNTIME_DOWNLOAD: 'false',
    },
  });
}

export function runBackendBoot(project: string): Promise<CommandResult> {
  return runTool(
    'pnpm',
    [
      '--filter',
      'backend',
      'exec',
      'jest',
      '--config',
      'test/jest-e2e.json',
      '--runInBand',
      '--runTestsByPath',
      'test/app/app.boot.e2e-spec.ts',
    ],
    { cwd: project },
  );
}

/**
 * Builds the project's root node_modules the way an install would: every
 * installed package comes from the repository, and each `@app/<name>` links to
 * the project's own shared/<name>, pruned like the rest of the project.
 */
function linkRootModules(project: string): void {
  linkModuleDirectory(join(REPO_ROOT, ROOT_MODULES), join(project, ROOT_MODULES), project);
}

function linkModuleDirectory(source: string, target: string, project: string): void {
  mkdirSync(join(target, SHARED_SCOPE), { recursive: true });

  for (const entry of readdirSync(source)) {
    if (entry !== SHARED_SCOPE) symlinkSync(join(source, entry), join(target, entry));
  }
  const shared = join(project, SHARED_DIRECTORY);
  for (const name of existsSync(shared) ? readdirSync(shared) : []) {
    symlinkSync(join(shared, name), join(target, SHARED_SCOPE, name), 'dir');
  }
}

/**
 * Borrows installed dependencies only for isolated feature-runtime unit fixtures.
 * Combination suites install their own graph with pnpm.
 */
export function linkDependencies(project: string): void {
  linkRootModules(project);
  for (const relative of LINKED_MODULES) {
    const source = join(REPO_ROOT, relative);
    // A workspace without dependencies may have no local module directory.
    if (!existsSync(source)) continue;

    const link = join(project, relative);
    mkdirSync(dirname(link), { recursive: true });
    linkModuleDirectory(source, link, project);
  }
}

export function typecheck(
  project: string,
  workspace: string,
  signal?: AbortSignal,
): Promise<CommandResult> {
  const binary = createRequire(join(project, workspace, 'package.json')).resolve(
    'typescript/bin/tsc',
  );
  return runTool(process.execPath, [binary, '--noEmit', '-p', workspace], {
    cwd: project,
    signal,
  });
}

/**
 * Name of the temporary tsconfig the combinations write into each generated
 * frontend. It is test scaffolding, never shipped with the template.
 */
export const PRUNED_SHARED_TSCONFIG = 'tsconfig.shared-pruned.json';

/**
 * Writes a frontend tsconfig that maps `@app/core` and `@app/sdk` straight to
 * the generated project's own (pruned) `shared/*` sources, without going
 * through node_modules. Extends the generated `frontend/tsconfig.json`;
 * `paths` replaces the base mapping, so the `@/` alias is repeated here.
 */
export async function writePrunedSharedTsconfig(project: string): Promise<void> {
  const config = {
    extends: './tsconfig.json',
    compilerOptions: {
      paths: {
        '@/*': ['./src/*'],
        '@app/core': ['../shared/core/src/index.ts'],
        '@app/core/*': ['../shared/core/src/*'],
        '@app/sdk': ['../shared/sdk/src/index.ts'],
      },
    },
  };
  await writeFile(
    join(project, 'frontend', PRUNED_SHARED_TSCONFIG),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  );
}

/** Typechecks the generated frontend against its own pruned `shared/*`. */
export function typecheckFrontendWithPrunedShared(project: string): Promise<CommandResult> {
  return runTool(
    process.execPath,
    [
      createRequire(join(project, 'frontend/package.json')).resolve('typescript/bin/tsc'),
      '--noEmit',
      '-p',
      `frontend/${PRUNED_SHARED_TSCONFIG}`,
    ],
    { cwd: project },
  );
}
