import {
  spawnSync,
  type SpawnOptions,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
} from 'node:child_process';
import { GIT_PUSH_KILL_SIGNAL, GIT_PUSH_TIMEOUT_MS } from '../../src/constants/index.js';
import { stopProcessTree } from './process-tree.js';

/**
 * The budget covers one push with its hook. The slowest one is refused by the
 * shared/core lint: about 2 s alone, 3.9 to 4.6 s at a load average near 50 on
 * 12 cores. `GIT_PUSH_TIMEOUT_MS` leaves six times the loaded worst.
 */
export function boundedGitPush(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeout = GIT_PUSH_TIMEOUT_MS,
): SpawnSyncReturns<string> {
  const options: SpawnSyncOptionsWithStringEncoding & Pick<SpawnOptions, 'detached'> = {
    cwd,
    env: { ...env, npm_config_offline: 'true', npm_config_update_notifier: 'false' },
    encoding: 'utf8',
    // Git leads its own process group, which is how its hook is found again.
    detached: true,
    timeout,
    killSignal: GIT_PUSH_KILL_SIGNAL,
  };
  const result = spawnSync('git', ['push', ...args], options);
  if (result.error) {
    // The bound stops Git alone; its hook and the hook's tools are still running.
    if (result.pid) stopProcessTree(result.pid);
    if ('code' in result.error && result.error.code === 'ETIMEDOUT')
      throw new Error(`Git push fixture timed out after ${timeout} ms.`);
    throw result.error;
  }
  return result;
}
