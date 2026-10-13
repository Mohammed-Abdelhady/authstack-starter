import { listFiles, removeFile } from '../utils/fs.js';
import { matchesAnyGlob } from '../utils/glob.js';

/**
 * Deletes every file under `root` matching one of `globs` and cleans up the
 * directories that become empty. Returns the deleted paths.
 */
export async function deleteMatchingFiles(root: string, globs: string[]): Promise<string[]> {
  if (globs.length === 0) return [];

  const files = await listFiles(root);
  const doomed = files.filter((file) => matchesAnyGlob(file, globs));

  for (const file of doomed) {
    await removeFile(root, file);
  }
  return doomed;
}
