import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { delimiter, extname, join } from 'node:path';
import { MARKER_EXTENSIONS, SKIPPED_DIRS } from '../../src/constants/index.js';
import { PACKAGE_DIR, STAGE_ENVIRONMENT, stagePackage } from './package-stage.js';
import { assertWorkspaceEdgesResolve } from '../support/workspace-assertions.js';
import { preparePackedWorkspace } from './packed-workspace.js';
import { BUILD_TIMEOUT } from '../support/run-tool.js';

export { PACKAGE_DIR, BUILD_TIMEOUT };

const PACKED_PACKAGE_FILE = 'create-authstack-starter.tgz';

export interface Packed {
  ok: boolean;
  reason?: string;
  cli: string;
  workspace: string;
  pnpmDirectory: string;
  cleanup: () => Promise<void>;
  runTask: ReturnType<typeof preparePackedWorkspace>['runTask'];
}

export function startPackedCli(): { packed: Packed; ready: Promise<void> } {
  const lifetime = preparePackedWorkspace();
  const { workspace, pnpmDirectory, cleanup, runTask } = lifetime;
  const packed: Packed = { ok: false, cli: '', workspace, pnpmDirectory, cleanup, runTask };
  return { packed, ready: buildAndPack(packed, lifetime.runCommand) };
}

async function buildAndPack(
  packed: Packed,
  runCommand: ReturnType<typeof preparePackedWorkspace>['runCommand'],
): Promise<void> {
  const { workspace } = packed;
  try {
    // Pack in the stage so concurrent tests do not see generated files rewritten.
    const tarball = join(workspace, PACKED_PACKAGE_FILE);
    const result = await runCommand('pnpm', ['pack', '--out', tarball], {
      cwd: stagePackage(workspace),
      timeout: BUILD_TIMEOUT,
      env: {
        ...STAGE_ENVIRONMENT,
        npm_config_cache: join(workspace, 'npm-cache'),
      },
    });
    if (!result.ok) {
      packed.reason = result.output;
      return;
    }
    const unpacked = await runCommand('tar', ['-xzf', tarball, '-C', workspace], {
      timeout: BUILD_TIMEOUT,
    });
    if (!unpacked.ok) {
      packed.reason = unpacked.output;
      return;
    }
    packed.cli = join(workspace, 'package', 'dist', 'index.js');
    packed.ok = existsSync(packed.cli);
    if (!packed.ok) packed.reason = 'the tarball has no dist/index.js';
  } catch (error) {
    packed.reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
  } finally {
    if (!packed.ok) await packed.cleanup();
  }
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
