import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface ContentException {
  path: string;
  reason: string;
}

/**
 * Files allowed to keep a forbidden word with an option off. Kept as short as
 * possible; each entry needs a reason.
 */
export const CONTENT_EXCEPTIONS: readonly ContentException[] = [];

/** Directories skipped when scanning generated content. */
export const SKIPPED_SCAN_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'coverage',
  'out',
]);

/** Lockfiles skipped when scanning generated content. */
export const SKIPPED_SCAN_FILES = new Set(['pnpm-lock.yaml']);

/** Files, relative to `root`, that contain one of `patterns`. */
export function findForbiddenContent(root: string, patterns: readonly RegExp[]): string[] {
  const excepted = new Set(CONTENT_EXCEPTIONS.map((entry) => entry.path));
  const hits: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_SCAN_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile() || SKIPPED_SCAN_FILES.has(entry.name)) continue;

      const path = relative(root, full).split('\\').join('/');
      if (excepted.has(path)) continue;

      const content = readFileSync(full, 'utf8');
      // A NUL byte means binary (a favicon), which is not text to match.
      if (content.includes('\u0000')) continue;
      if (patterns.some((pattern) => pattern.test(content))) hits.push(path);
    }
  };

  walk(root);
  return hits.sort();
}

/**
 * Every line under `root` that matches one of `patterns`, by file, trimmed and
 * in the order the file holds them.
 */
export function findForbiddenLines(
  root: string,
  patterns: readonly RegExp[],
): Record<string, string[]> {
  const lines: Record<string, string[]> = {};
  for (const path of findForbiddenContent(root, patterns)) {
    lines[path] = readFileSync(join(root, path), 'utf8')
      .split('\n')
      .filter((line) => patterns.some((pattern) => pattern.test(line)))
      .map((line) => line.trim());
  }
  return lines;
}
