import { createHash } from 'node:crypto';

const COMMIT_PATTERNS = { sha1: /^[0-9a-f]{40}$/, sha256: /^[0-9a-f]{64}$/ };
const SYMLINK_MODE = '120000';
const EXECUTABLE_MODE = '100755';

// Each template source HEAD holds as a file: its executable bit and blob. Links never ship.
function headEntries(git, root, isTemplateSource) {
  const entries = new Map();
  const output = git(root, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD']);
  for (const line of output.split('\0').filter(Boolean)) {
    const tab = line.indexOf('\t');
    const [mode, type, blob] = line.slice(0, tab).split(' ');
    const path = line.slice(tab + 1);
    if (type === 'blob' && mode !== SYMLINK_MODE && isTemplateSource(path)) {
      entries.set(path, { executable: mode === EXECUTABLE_MODE, blob });
    }
  }
  return entries;
}

function blobId(format, bytes) {
  return createHash(format).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

// The copied set equals HEAD's template sources: same paths, executable bits and bytes.
function matchesHead(head, copied, format) {
  const paths = new Set(copied.map((entry) => entry.path));
  if (paths.size !== copied.length || paths.size !== head.size) return false;
  return copied.every(({ path, mode, bytes }) => {
    const entry = head.get(path);
    if (entry === undefined) return false;
    if (entry.executable !== ((mode & 0o111) !== 0)) return false;
    return entry.blob === blobId(format, bytes);
  });
}

// The HEAD commit when the files the build copied and read equal its tree, else
// null. A sparse checkout, any difference or any git error never fails the build.
export function templateCommit(git, root, build) {
  try {
    const format = git(root, ['rev-parse', '--show-object-format']).trim();
    if (!Object.hasOwn(COMMIT_PATTERNS, format)) return null;
    const pattern = COMMIT_PATTERNS[format];
    const head = git(root, ['rev-parse', '--verify', 'HEAD']).trim();
    if (!pattern.test(head)) return null;
    const sparse = git(root, ['config', '--bool', '--default', 'false', 'core.sparseCheckout']);
    if (sparse.trim() === 'true') return null;
    const entries = headEntries(git, root, build.isTemplateSource);
    return matchesHead(entries, build.copied, format) ? head : null;
  } catch {
    return null;
  }
}
