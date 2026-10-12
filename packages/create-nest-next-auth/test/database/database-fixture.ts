import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { emptyDatabase } from '../../src/manifest/validate-dimensions.js';
import type { Database } from '../../src/types.js';

const roots: string[] = [];

/** Removes every project a case made. Call it from `afterEach`. */
export async function removeProjects(): Promise<void> {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}

/** A project folder holding the given files. */
export async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-database-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

/** A database entry that owns only what the case gives it. */
export function database(owned: Partial<Database>): Database {
  return { ...emptyDatabase(), label: 'Second', status: undefined, ...owned };
}

export const read = (root: string, path: string): Promise<string> =>
  readFile(join(root, path), 'utf8');
