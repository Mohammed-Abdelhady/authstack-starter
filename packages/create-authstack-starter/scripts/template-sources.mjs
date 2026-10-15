import { lstat } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';

// True when the path, or any directory above it, is left out of the template.
export function isExcludedPath(segments, isExcluded) {
  return segments.some((name, index) =>
    isExcluded(segments.slice(0, index + 1).join(sep), name, index < segments.length - 1),
  );
}

// The lstat of a regular file under root the copier may ship, else null.
export async function sourceStats(root, source) {
  try {
    const stats = await lstat(source);
    if (!stats.isFile()) return null;
    // A tracked child must not make a replaced parent symlink traversable.
    for (
      let directory = dirname(source);
      directory !== root && directory !== dirname(directory);
      directory = dirname(directory)
    ) {
      if (!(await lstat(directory)).isDirectory()) return null;
    }
    return stats;
  } catch (error) {
    // Tracked, then deleted from the working tree: there is nothing to ship.
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// The tracked paths the copier ships, in index order, each with its lstat.
export async function selectSources(root, trackedPaths, isExcluded) {
  const selected = [];
  for (const path of trackedPaths) {
    const segments = path.split('/');
    if (isExcludedPath(segments, isExcluded)) continue;
    const stats = await sourceStats(root, join(root, ...segments));
    if (stats !== null) selected.push({ path, stats });
  }
  return selected;
}
