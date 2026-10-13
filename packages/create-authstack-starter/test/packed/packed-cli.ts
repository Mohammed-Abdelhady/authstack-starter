import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, extname, join } from 'node:path';
import {
  MARKER_EXTENSIONS,
  PACKAGE_MANAGER_VERSION,
  SKIPPED_DIRS,
} from '../../src/constants/index.js';
import { PACKAGE_DIR, STAGE_ENVIRONMENT, stagePackage } from './package-stage.js';
import { assertWorkspaceEdgesResolve } from '../support/workspace-assertions.js';

export { PACKAGE_DIR };
export const BUILD_TIMEOUT = 10 * 60 * 1000;

export interface Packed {
  ok: boolean;
  reason?: string;
  cli: string;
  workspace: string;
  pnpmDirectory: string;
}

/** Builds the package, packs it, and unpacks the tarball into a temp directory. */
export function buildAndPack(): Packed {
  const workspace = mkdtempSync(join(tmpdir(), 'cna-e2e-'));
  const pnpmDirectory = join(workspace, 'pnpm-bin');
  mkdirSync(pnpmDirectory);
  const pnpm = join(pnpmDirectory, 'pnpm');
  writeFileSync(
    pnpm,
    `#!${process.execPath}\nconst args = process.argv.slice(2).join(' ');\nif (args === '--version') process.stdout.write(${JSON.stringify(PACKAGE_MANAGER_VERSION)} + '\\n');\n`,
  );
  chmodSync(pnpm, 0o755);
  const packed: Packed = { ok: false, cli: '', workspace, pnpmDirectory };

  try {
    // prepack runs the build, so packing alone ships a fresh template,
    // manifest and identity; a second explicit build would repeat it. It runs
    // in a staged copy: other test files run while this one packs, and a build
    // in the package folder would rewrite generated files under them.
    const output = execFileSync('npm', ['pack', '--pack-destination', workspace], {
      cwd: stagePackage(workspace),
      timeout: BUILD_TIMEOUT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // Pack writes to the npm cache. Keep it in the workspace so the test does
      // not depend on write access to the developer's ~/.npm.
      env: {
        ...process.env,
        ...STAGE_ENVIRONMENT,
        npm_config_cache: join(workspace, 'npm-cache'),
      },
    });
    const tarball = output.trim().split('\n').pop() ?? '';
    execFileSync('tar', ['-xzf', join(workspace, tarball), '-C', workspace], { stdio: 'pipe' });

    packed.cli = join(workspace, 'package', 'dist', 'index.js');
    packed.ok = existsSync(packed.cli);
    if (!packed.ok) packed.reason = 'the tarball has no dist/index.js';
  } catch (error) {
    packed.reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
  }

  if (!packed.ok) rmSync(workspace, { recursive: true, force: true });
  return packed;
}

const MARKER_COMMENT = /(\/\/|\{\/\*)\s*feature:[a-z0-9-]/;

/** Generated source files that still carry a marker comment. */
export function sourceFilesWithMarkers(root: string, prefix = ''): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      found.push(...sourceFilesWithMarkers(root, relative));
      continue;
    }
    if (!(MARKER_EXTENSIONS as readonly string[]).includes(extname(entry.name))) continue;
    const content = readFileSync(join(root, relative), 'utf8');
    if (MARKER_COMMENT.test(content)) found.push(relative);
  }

  return found;
}

/** Scaffolds one project from the packed CLI into the packed workspace. */
export function scaffold(
  packed: Packed,
  name: string,
  features?: string,
  options: { git?: boolean; env?: NodeJS.ProcessEnv; flags?: string[] } = {},
): ReturnType<typeof spawnSync> {
  const target = join(packed.workspace, name);
  const args = [packed.cli, target, '--yes', '--no-install'];
  if (!options.git) args.push('--no-git');
  if (features !== undefined) args.push('--features', features);
  args.push(...(options.flags ?? []));
  const env = { ...process.env, ...options.env };
  if (!Object.hasOwn(options.env ?? {}, 'PATH')) {
    env.PATH = [packed.pnpmDirectory, env.PATH ?? ''].filter(Boolean).join(delimiter);
  } else if (env.PATH) {
    env.PATH = [packed.pnpmDirectory, env.PATH].join(delimiter);
  }
  const result = spawnSync(process.execPath, args, {
    cwd: packed.workspace,
    env,
    encoding: 'utf8',
    timeout: BUILD_TIMEOUT,
  });
  if (result.status === 0) assertWorkspaceEdgesResolve(target);
  return result;
}
