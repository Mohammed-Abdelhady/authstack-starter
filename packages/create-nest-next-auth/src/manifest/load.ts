import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MANIFEST_FILE, REWRITES_FILE } from '../constants/index.js';
import type { Manifest } from '../types.js';
import { parseJson } from '../utils/parse-json.js';
import { isRecord } from './read.js';
import { ManifestError, validateManifest } from './validate.js';

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Puts each database's rewrites from the sibling file after the ones the
 * manifest holds. A key that is not a database of the manifest is a problem:
 * its rewrites would never run.
 */
export function mergeRewrites(manifest: unknown, rewrites: unknown): unknown {
  if (!isRecord(manifest) || !isRecord(manifest.databases)) return manifest;
  if (!isRecord(rewrites)) throw new ManifestError([`${REWRITES_FILE} must be an object`]);
  const databases: Record<string, unknown> = { ...manifest.databases };
  const problems: string[] = [];
  for (const [id, entries] of Object.entries(rewrites)) {
    if (id.startsWith('$')) continue;
    const database = databases[id];
    if (!isRecord(database)) {
      problems.push(`${REWRITES_FILE} names "${id}", which is not a database of the manifest`);
      continue;
    }
    if (!Array.isArray(entries)) {
      problems.push(`${REWRITES_FILE}.${id} must be an array`);
      continue;
    }
    const inline: unknown[] = Array.isArray(database.rewrites) ? database.rewrites : [];
    databases[id] = { ...database, rewrites: [...inline, ...entries] };
  }
  if (problems.length > 0) throw new ManifestError(problems);
  return { ...manifest, databases };
}

/**
 * Reads template.manifest.json from a package or repository root, with the
 * rewrites of template.rewrites.json beside it when that file is there.
 */
export async function loadManifest(root: string): Promise<Manifest> {
  const path = join(root, MANIFEST_FILE);
  const parsed = parseJson(await readFile(path, 'utf8'), path);
  const rewritesPath = join(root, REWRITES_FILE);
  const rewrites = await readOptional(rewritesPath);
  return validateManifest(
    rewrites === undefined ? parsed : mergeRewrites(parsed, parseJson(rewrites, rewritesPath)),
  );
}
