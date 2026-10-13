import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isRecord } from '../manifest/read.js';
import type { Manifest } from '../types.js';
import { readFileIfExists } from '../utils/fs.js';

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function deletePath(tree: Record<string, unknown>, path: string[]): boolean {
  const [head, ...rest] = path;
  if (head === undefined) return false;
  if (rest.length === 0) {
    if (!(head in tree)) return false;
    delete tree[head];
    return true;
  }
  const child = tree[head];
  if (!isRecord(child)) return false;
  return deletePath(child, rest);
}

function hasPath(tree: Record<string, unknown>, path: string[]): boolean {
  const [head, ...rest] = path;
  if (head === undefined || !(head in tree)) return false;
  if (rest.length === 0) return true;
  const child = tree[head];
  return isRecord(child) && hasPath(child, rest);
}

/** Removes dotted keys from a parsed catalogue. Pure. */
export function pruneCatalogueKeys(
  catalogue: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  if (keys.length === 0) return catalogue;

  const clone = structuredClone(catalogue);
  let changed = false;
  for (const key of keys) {
    changed = deletePath(clone, key.split('.')) || changed;
  }
  return changed ? clone : catalogue;
}

/** Catalogue paths and the keys the removed options own, from the manifest. */
function removedCatalogueKeys(
  manifest: Manifest,
  removedOptions: readonly string[],
): Map<string, Set<string>> {
  const rules = new Map<string, Set<string>>();
  for (const id of removedOptions) {
    for (const rule of manifest.options[id]?.catalogueKeys ?? []) {
      const keys = rules.get(rule.path) ?? new Set<string>();
      for (const key of rule.keys) keys.add(key);
      rules.set(rule.path, keys);
    }
  }
  return rules;
}

/** Applies the transform to each catalogue that loses a key. */
export async function pruneMessageCatalogues(
  root: string,
  manifest: Manifest,
  removedOptions: readonly string[],
): Promise<string[]> {
  const edited: string[] = [];

  for (const [relative, keys] of removedCatalogueKeys(manifest, removedOptions)) {
    if (keys.size === 0) continue;
    const path = join(root, relative);

    const raw = await readFileIfExists(path);
    if (raw === undefined) continue;

    const parsed: unknown = (() => {
      try {
        return JSON.parse(raw);
      } catch (error) {
        throw new Error(`Could not parse ${relative}: ${reasonOf(error)}`);
      }
    })();
    if (!isRecord(parsed)) continue;

    for (const key of keys) {
      if (!hasPath(parsed, key.split('.'))) {
        throw new Error(`Catalogue key "${key}" is not in ${relative}`);
      }
    }

    const updated = pruneCatalogueKeys(parsed, [...keys]);
    if (updated === parsed) continue;

    await writeFile(path, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
    edited.push(relative);
  }

  return edited;
}
