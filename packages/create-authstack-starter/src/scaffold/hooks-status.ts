import { constants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { RULES_HOOK_PATHS } from '../constants/rules.js';
import { run } from '../utils/exec.js';

export async function readHookStatus(
  root: string,
): Promise<{ ownRepository: boolean; active: boolean }> {
  const repository = await run('git', ['rev-parse', '--show-toplevel'], root);
  const ownRepository =
    repository.code === 0 && (await realpath(repository.stdout.trim())) === (await realpath(root));
  if (!ownRepository) return { ownRepository, active: false };
  const configuration = await run('git', ['config', '--local', '--get', 'core.hooksPath'], root);
  if (configuration.code !== 0 || configuration.stdout.trim() === '')
    return { ownRepository, active: false };
  const hookRoot = resolve(root, configuration.stdout.trim());
  return { ownRepository, active: await hookFilesActive(root, hookRoot) };
}

export async function hookFilesActive(
  root: string,
  hookRoot: string,
  check: (path: string, mode: number) => Promise<void> = access,
): Promise<boolean> {
  // Husky's wrappers need their shared runner as well as the project hook bodies.
  try {
    await check(join(hookRoot, 'h'), constants.F_OK);
    for (const path of RULES_HOOK_PATHS) {
      await check(join(root, path), constants.F_OK);
      await check(join(hookRoot, path.split('/').at(-1) ?? ''), constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}
