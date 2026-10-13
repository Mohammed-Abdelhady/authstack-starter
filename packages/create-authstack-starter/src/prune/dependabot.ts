import { writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { readFileIfExists } from '../utils/fs.js';

/** Dependabot entries track files kept by the generated project. */
export const DEPENDABOT_FILE = '.github/dependabot.yml';
const GLOB_MARKERS = ['*', '?', '[', ']', '{', '}', '!', '(', ')', '\\'];

function entryUsesDeletedDockerfile(entry: unknown, deleted: Set<string>): boolean {
  if (!isMap(entry)) return false;
  const plain = entry.toJSON() as Record<string, unknown>;
  if (plain['package-ecosystem'] !== 'docker') return false;
  if (typeof plain.directory !== 'string') return false;
  const directory = plain.directory.replace(/^\/+/, '').replace(/\/+$/, '');
  const dockerfile = directory === '' ? 'Dockerfile' : `${directory}/Dockerfile`;
  return deleted.has(dockerfile);
}

function isLiteralFilePath(path: string): boolean {
  return (
    path.length > 0 && !path.endsWith('/') && !GLOB_MARKERS.some((marker) => path.includes(marker))
  );
}

function pruneDeletedNpmExclusions(entry: unknown, deleted: Set<string>): boolean {
  if (!isMap(entry)) return false;
  const plain = entry.toJSON() as Record<string, unknown>;
  if (plain['package-ecosystem'] !== 'npm' || typeof plain.directory !== 'string') return false;

  const exclusions = entry.get('exclude-paths', true);
  if (!isSeq(exclusions)) return false;

  const directory = posix.normalize(plain.directory).replace(/^\/+/, '').replace(/\/+$/, '');
  const kept = exclusions.items.filter((item) => {
    if (!isScalar(item) || typeof item.value !== 'string' || !isLiteralFilePath(item.value)) {
      return true;
    }

    const target = posix.normalize(posix.join(directory, item.value)).replace(/^\/+/, '');
    return target.startsWith('../') || target === '..' || !deleted.has(target);
  });
  if (kept.length === exclusions.items.length) return false;

  if (kept.length === 0) entry.delete('exclude-paths');
  else exclusions.items = kept;
  return true;
}

/**
 * Drops update entries and exact manifest exclusions for files removed by the
 * selected project. Untouched text, quotes and blank lines stay in place.
 * Returns false when nothing changed.
 */
export async function pruneDependabot(
  root: string,
  deletedFiles: readonly string[],
): Promise<boolean> {
  const path = join(root, DEPENDABOT_FILE);
  const raw = await readFileIfExists(path);
  if (raw === undefined) return false;

  const document = parseDocument(raw);
  if (document.errors.length > 0) {
    throw new Error(`Could not parse ${DEPENDABOT_FILE}: ${document.errors[0].message}`);
  }
  const updates = document.get('updates');
  if (!isSeq(updates)) return false;

  const deleted = new Set(deletedFiles);
  let changed = false;
  const kept = updates.items.filter((entry) => {
    if (entryUsesDeletedDockerfile(entry, deleted)) {
      changed = true;
      return false;
    }
    if (pruneDeletedNpmExclusions(entry, deleted)) changed = true;
    return true;
  });
  if (!changed) return false;

  updates.items = kept;
  await writeFile(path, document.toString(), 'utf8');
  return true;
}
