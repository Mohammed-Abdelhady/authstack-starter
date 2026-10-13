import { cp, lstat, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { RESTORED_FILENAMES, SKIPPED_DIRS } from '../constants/index.js';

async function restoreNames(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      await restoreNames(path);
      continue;
    }
    const restored = RESTORED_FILENAMES[entry.name];
    if (restored !== undefined) await rename(path, join(directory, restored));
  }
}

/**
 * Copies the bundled template into the target directory and restores the file
 * names npm refuses to publish (.gitignore, pnpm-lock.yaml, .npmrc). A
 * symbolic-link template is refused, so the pruner never edits the package's
 * own template through the target.
 */
export async function copyTemplate(templateDir: string, target: string): Promise<void> {
  const stats = await lstat(templateDir);
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to scaffold from a symbolic link: ${templateDir}`);
  }
  await cp(templateDir, target, { recursive: true });
  await restoreNames(target);
}
