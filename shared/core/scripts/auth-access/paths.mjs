import { lstat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

async function inspectPart(path, leaf) {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT' && leaf) return;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error('Host access paths must not contain symbolic links');
}

export async function assertLocalPath(root, path) {
  const suffix = relative(root, path);
  if (!suffix || suffix.startsWith(`..${sep}`) || suffix === '..')
    throw new Error('Host access path must stay inside the API checkout');
  let current = root;
  const parts = suffix.split(sep);
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    await inspectPart(current, index === parts.length - 1);
  }
}
