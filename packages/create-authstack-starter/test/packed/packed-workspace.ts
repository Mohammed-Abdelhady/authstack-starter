import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKAGE_MANAGER_VERSION } from '../../src/constants/index.js';
import { allocatePackedWorkspace } from './temporary-workspace.js';

export function preparePackedWorkspace(
  root = tmpdir(),
  filesystem: Pick<typeof import('node:fs'), 'mkdirSync' | 'writeFileSync' | 'chmodSync'> = {
    mkdirSync,
    writeFileSync,
    chmodSync,
  },
): ReturnType<typeof allocatePackedWorkspace> & { pnpmDirectory: string } {
  const lifetime = allocatePackedWorkspace(root);
  const { workspace, cleanup } = lifetime;
  const pnpmDirectory = join(workspace, 'pnpm-bin');
  try {
    filesystem.mkdirSync(pnpmDirectory);
    const pnpm = join(pnpmDirectory, 'pnpm');
    filesystem.writeFileSync(
      pnpm,
      `#!${process.execPath}\nconst args = process.argv.slice(2).join(' ');\nif (args === '--version') process.stdout.write(${JSON.stringify(PACKAGE_MANAGER_VERSION)} + '\\n');\n`,
    );
    filesystem.chmodSync(pnpm, 0o755);
    return { ...lifetime, pnpmDirectory };
  } catch (error) {
    void cleanup();
    throw error;
  }
}
