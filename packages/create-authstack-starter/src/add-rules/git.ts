import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADD_RULES_GIT_BINARY } from '../constants/rules.js';
import { run } from '../utils/exec.js';

export async function inspectGit(root: string): Promise<string[]> {
  const empty = await mkdtemp(join(tmpdir(), 'rules-no-hooks-'));
  try {
    const options = [
      '--no-optional-locks',
      '-c',
      'core.fsmonitor=false',
      '-c',
      `core.hooksPath=${empty}`,
    ];
    const repository = await run(
      ADD_RULES_GIT_BINARY,
      [...options, 'config', '-z', '--local', '--get-all', 'core.hooksPath'],
      root,
    );
    if (repository.code !== 0 && repository.code !== 1)
      throw new Error(`Could not inspect Git repository hooks: ${repository.stderr}`);
    // --get-all includes our command-scope override. Only that exact value is excluded.
    const hooks = await run(
      ADD_RULES_GIT_BINARY,
      [...options, 'config', '-z', '--get-all', 'core.hooksPath'],
      root,
    );
    if (hooks.code !== 0 && hooks.code !== 1)
      throw new Error(`Could not inspect Git hooks: ${hooks.stderr}`);
    return hooks.stdout
      .split('\0')
      .slice(0, -1)
      .filter((path) => path !== empty);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
}
