import { readdir, readFile, rm, rmdir } from 'node:fs/promises';
import { dirname, join, posix, relative, sep } from 'node:path';
import { PACKAGE_MANIFEST, SKIPPED_DIRS } from '../constants/index.js';

/** Lists every file under `root` as a posix path relative to `root`. */
export async function listFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        await walk(full);
        continue;
      }
      if (entry.isFile()) found.push(toPosix(relative(root, full)));
    }
  }

  await walk(root);
  return found.sort();
}

/** A package manifest at the root or in any workspace. */
export function isPackageManifest(file: string): boolean {
  return file === PACKAGE_MANIFEST || file.endsWith(`/${PACKAGE_MANIFEST}`);
}

export function toPosix(path: string): string {
  return path.split(sep).join(posix.sep);
}

/** Narrows an unknown thrown value to one that carries an errno `code`. */
export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/**
 * Reads a UTF-8 file, or returns undefined when it does not exist. Any other
 * read error is rethrown naming the path.
 */
export async function readFileIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return undefined;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${path}: ${reason}`);
  }
}

/** Removes a file and any directories it leaves empty, stopping at `root`. */
export async function removeFile(root: string, relativePath: string): Promise<void> {
  const target = join(root, relativePath);
  await rm(target, { force: true });

  let directory = dirname(target);
  while (directory.startsWith(root) && directory !== root) {
    try {
      await rmdir(directory);
    } catch (error) {
      // A directory that still has entries (or is already gone) stops the walk;
      // anything else is a real failure.
      if (isErrnoException(error) && (error.code === 'ENOTEMPTY' || error.code === 'ENOENT')) {
        return;
      }
      throw error;
    }
    directory = dirname(directory);
  }
}
