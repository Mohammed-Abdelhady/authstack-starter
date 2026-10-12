import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readFileIfExists } from '../utils/fs.js';

/** The ignore file whose entries follow the folders they name. */
export const IGNORE_FILE = '.gitignore';

const WHOLE_TREE = '/**';

/** The folders a list of removed globs takes away whole: \`mobile/expo/**\` gives \`mobile/expo\`. */
export function removedFolders(globs: readonly string[]): string[] {
  return globs
    .filter((glob) => glob.endsWith(WHOLE_TREE))
    .map((glob) => glob.slice(0, -WHOLE_TREE.length))
    .filter((folder) => !/[*?[]/.test(folder));
}

function isComment(line: string): boolean {
  return line.trimStart().startsWith('#');
}

/**
 * Drops the entries that sit inside a removed folder, and a comment block left
 * with no entry under it. Everything else keeps its place. Pure.
 */
export function pruneIgnoreEntries(content: string, folders: readonly string[]): string {
  if (folders.length === 0) return content;
  const inside = (line: string): boolean => {
    const entry = line.trim().replace(/^\//, '');
    return folders.some((folder) => entry === folder || entry.startsWith(`${folder}/`));
  };

  const kept: string[] = [];
  // Comment lines directly above the entries being read, not yet known to be needed.
  let pending: string[] = [];
  let survivors = 0;
  let dropped = 0;
  const closeGroup = (): void => {
    if (survivors > 0 || dropped === 0) kept.push(...pending);
    pending = [];
    survivors = 0;
    dropped = 0;
  };

  for (const line of content.split('\n')) {
    if (line.trim() === '') {
      const emptied = dropped > 0 && survivors === 0;
      closeGroup();
      // The blank line that closed an emptied group goes with it.
      if (!emptied || kept.length === 0 || kept[kept.length - 1].trim() !== '') kept.push(line);
      continue;
    }
    if (isComment(line)) {
      if (survivors > 0 || dropped > 0) closeGroup();
      pending.push(line);
      continue;
    }
    if (inside(line)) {
      dropped += 1;
      continue;
    }
    kept.push(...pending, line);
    pending = [];
    survivors += 1;
  }
  closeGroup();
  return kept.join('\n');
}

/** Applies pruneIgnoreEntries to the project's ignore file. True when it changed. */
export async function pruneIgnoreFile(
  root: string,
  removedGlobs: readonly string[],
): Promise<boolean> {
  const path = join(root, IGNORE_FILE);
  const content = await readFileIfExists(path);
  if (content === undefined) return false;
  const pruned = pruneIgnoreEntries(content, removedFolders(removedGlobs));
  if (pruned === content) return false;
  await writeFile(path, pruned, 'utf8');
  return true;
}
