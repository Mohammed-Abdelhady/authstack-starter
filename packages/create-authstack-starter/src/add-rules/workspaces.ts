import { posix } from 'node:path';
import { SKIPPED_DIRS } from '../constants/index.js';
import { matchesAnyGlob } from '../utils/glob.js';
import { checkPath } from './paths.js';
import { ProjectPaths } from './project-paths.js';

export async function inspectWorkspacePaths(root: string, patterns: string[]): Promise<string[]> {
  const includes = patterns.filter((pattern) => !pattern.startsWith('!'));
  const excludes = patterns
    .filter((pattern) => pattern.startsWith('!'))
    .map((pattern) => pattern.slice(1));
  const found: string[] = [];
  const paths = await ProjectPaths.open(root);
  async function walk(path: string): Promise<void> {
    for (const entry of await paths.entries(path)) {
      if (SKIPPED_DIRS.has(entry.name) || entry.name === '.git') continue;
      const child = path ? posix.join(path, entry.name) : entry.name;
      if (entry.isSymbolicLink()) {
        // A wildcard may hide a symlinked parent. Refuse it before workspace discovery.
        await checkPath(root, child);
      }
      if (entry.isDirectory()) await walk(child);
      if (
        entry.isFile() &&
        entry.name === 'package.json' &&
        path !== '' &&
        matchesAnyGlob(path, includes) &&
        !matchesAnyGlob(path, excludes)
      )
        found.push(path);
    }
  }
  try {
    if (patterns.length) await walk('');
    return found.sort();
  } finally {
    await paths.close();
  }
}
