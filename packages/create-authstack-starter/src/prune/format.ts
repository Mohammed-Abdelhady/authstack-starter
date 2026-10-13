import { writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { isRecord } from '../manifest/read.js';
import { readFileIfExists } from '../utils/fs.js';
import { parseJson } from '../utils/parse-json.js';
import * as babel from 'prettier/plugins/babel';
import * as estree from 'prettier/plugins/estree';
import * as markdown from 'prettier/plugins/markdown';
import * as typescript from 'prettier/plugins/typescript';
import * as yaml from 'prettier/plugins/yaml';
import { format } from 'prettier/standalone';

/**
 * Only the parsers the template's own file types need. Importing the full
 * prettier package bundles every parser, which more than quadruples `dist`.
 */
const PLUGINS = [babel, estree, typescript, markdown, yaml];

/** Extensions the pruner can rewrite and prettier can parse. */
const FORMATTABLE = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
]);

/**
 * The nearest prettier config above the file, the way prettier resolves it. A
 * workspace with its own `.prettierrc` (the backend) does not inherit the root.
 */
async function resolvePrettierConfig(
  root: string,
  relative: string,
): Promise<Record<string, unknown>> {
  let directory = dirname(resolve(root, relative));
  const boundary = resolve(root);

  for (;;) {
    for (const name of ['.prettierrc', '.prettierrc.json']) {
      const path = join(directory, name);
      const raw = await readFileIfExists(path);
      if (raw === undefined) continue;
      const parsed = parseJson(raw, path);
      if (isRecord(parsed)) return parsed;
    }
    if (directory === boundary) return {};
    const parent = dirname(directory);
    if (parent === directory || !parent.startsWith(boundary)) return {};
    directory = parent;
  }
}

/**
 * Formats the files the pruner changed with the nearest prettier config, so a
 * fresh scaffold passes its own lint without a manual format run. Files with no
 * parser are skipped.
 */
export async function formatChangedFiles(root: string, files: string[]): Promise<string[]> {
  const formatted: string[] = [];

  for (const relative of [...new Set(files)]) {
    if (!FORMATTABLE.has(extname(relative))) continue;

    const path = join(root, relative);
    const content = await readFileIfExists(path);
    if (content === undefined) continue;

    const config = await resolvePrettierConfig(root, relative);
    let output: string;
    try {
      output = await format(content, { ...config, filepath: path, plugins: PLUGINS });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not format ${relative}: ${reason}`);
    }
    if (output === content) continue;

    await writeFile(path, output, 'utf8');
    formatted.push(relative);
  }

  return formatted;
}
