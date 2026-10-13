import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { lastLines, run } from '../utils/exec.js';
import {
  INSTALL_DIAGNOSTIC_LINES,
  MISSING_PNPM_MESSAGE,
  PACKAGE_MANAGER,
  PACKAGE_MANAGER_VERSION,
  PNPM_LOCKFILE,
} from '../constants/index.js';

export interface InstallResult {
  ok: boolean;
  reason?: string;
}

export async function pnpmAvailable(cwd: string): Promise<boolean> {
  const result = await run(PACKAGE_MANAGER, ['--version'], cwd);
  return result.code === 0 && result.stdout.trim() === PACKAGE_MANAGER_VERSION;
}

export async function prepareLockfile(root: string): Promise<InstallResult> {
  if (!(await pnpmAvailable(root))) {
    await rm(join(root, PNPM_LOCKFILE), { force: true });
    return { ok: false, reason: MISSING_PNPM_MESSAGE };
  }

  const result = await run(PACKAGE_MANAGER, ['install', '--lockfile-only'], root);
  if (result.code === 0) return { ok: true };

  await rm(join(root, PNPM_LOCKFILE), { force: true });
  return {
    ok: false,
    reason: lastLines(result.stderr || result.stdout, INSTALL_DIAGNOSTIC_LINES),
  };
}

export async function installDependencies(root: string): Promise<InstallResult> {
  const result = await run(PACKAGE_MANAGER, ['install', '--frozen-lockfile'], root);
  if (result.code === 0) return { ok: true };
  return {
    ok: false,
    reason: lastLines(result.stderr || result.stdout, INSTALL_DIAGNOSTIC_LINES),
  };
}
