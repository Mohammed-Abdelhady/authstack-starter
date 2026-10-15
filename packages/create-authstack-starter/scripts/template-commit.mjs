import { lstatSync } from 'node:fs';
import { join } from 'node:path';

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SYMLINK_MODE = '120000';
const EXECUTABLE_MODE = '100755';

function paths(output) {
  return output.split('\0').filter(Boolean);
}

// Each template source HEAD holds as a file: its mode and blob. Symbolic links never ship.
function headEntries(git, root, isTemplateSource) {
  const entries = new Map();
  for (const line of paths(git(root, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD']))) {
    const tab = line.indexOf('\t');
    const [mode, type, blob] = line.slice(0, tab).split(' ');
    const path = line.slice(tab + 1);
    if (type === 'blob' && mode !== SYMLINK_MODE && isTemplateSource(path)) {
      entries.set(path, { mode, blob });
    }
  }
  return entries;
}

// Template sources the working tree lists: tracked, or untracked and not ignored.
function listedSources(git, root, isTemplateSource) {
  const listed = [
    ...paths(git(root, ['ls-files', '-z'])),
    ...paths(git(root, ['ls-files', '--others', '--exclude-standard', '-z'])),
  ];
  return [...new Set(listed)].filter(isTemplateSource);
}

function statOrNull(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

// The files to hash, or null when a source is missing on either side or its mode differs.
function filesToHash(root, head, listed) {
  const files = [];
  for (const path of new Set([...head.keys(), ...listed])) {
    const stats = statOrNull(join(root, path));
    const entry = head.get(path);
    if (stats === null || !stats.isFile()) {
      if (entry !== undefined) return null;
      continue;
    }
    if (entry === undefined || path.includes('\n')) return null;
    if ((entry.mode === EXECUTABLE_MODE) !== ((stats.mode & 0o111) !== 0)) return null;
    files.push(path);
  }
  return files;
}

// Hashes the bytes on disk, so assume-unchanged and skip-worktree cannot hide an edit.
function matchesHead(git, root, isTemplateSource) {
  const head = headEntries(git, root, isTemplateSource);
  const files = filesToHash(root, head, listedSources(git, root, isTemplateSource));
  if (files === null) return false;
  if (files.length === 0) return true;
  const input = `${files.join('\n')}\n`;
  const hashes = git(root, ['hash-object', '--no-filters', '--stdin-paths'], input)
    .trim()
    .split('\n');
  return files.every((path, index) => hashes[index] === head.get(path)?.blob);
}

// The HEAD commit when every template source on disk matches it byte for byte,
// else null. A sparse checkout, a dirty tree or any git error never fails the build.
export function templateCommit(git, root, isTemplateSource) {
  try {
    const head = git(root, ['rev-parse', '--verify', 'HEAD']).trim();
    if (!COMMIT_PATTERN.test(head)) return null;
    const sparse = git(root, ['config', '--bool', '--default', 'false', 'core.sparseCheckout']);
    if (sparse.trim() === 'true') return null;
    return matchesHead(git, root, isTemplateSource) ? head : null;
  } catch {
    return null;
  }
}
