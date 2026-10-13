import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RULES_STAGED_CONFIG } from '../constants/rules.js';
import { readFileIfExists } from '../utils/fs.js';

const STAGED_ENTRY = /^ {2}'([^']+)': \[[\s\S]*?\],\r?\n/gm;

/** Drops tasks for directories removed from the copied template. */
export async function pruneLintStaged(root: string): Promise<boolean> {
  const path = join(root, RULES_STAGED_CONFIG);
  const source = await readFileIfExists(path);
  if (source === undefined) return false;
  let rendered = source;
  for (const match of source.matchAll(STAGED_ENTRY)) {
    const glob = match[1];
    const prefix = glob.slice(0, glob.indexOf('*')).replace(/\/$/, '');
    if (prefix === '') continue;
    try {
      if ((await stat(join(root, prefix))).isDirectory()) continue;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
    rendered = rendered.replace(match[0], '');
  }
  if (rendered === source) return false;
  await writeFile(path, rendered, 'utf8');
  return true;
}
