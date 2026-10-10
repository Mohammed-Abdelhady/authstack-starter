import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PACKAGE_DEPENDENCY_GROUPS, PACKAGE_MANIFEST } from '../constants/index.js';
import { isRecord } from '../manifest/read.js';
import type { Database, DatabaseRewrite, Manifest } from '../types.js';
import { listFiles, readFileIfExists } from '../utils/fs.js';
import { matchesAnyGlob } from '../utils/glob.js';

/** Where the commands of a database live. */
export const DATABASE_SCRIPTS_MANIFEST = 'backend/package.json';

export class DatabasePruneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabasePruneError';
  }
}

export interface DatabaseSplit {
  kept: Database[];
  removed: Database[];
}

/** The chosen databases, and the ones a project of this choice does not carry. */
export function splitDatabases(
  manifest: Pick<Manifest, 'databases'>,
  chosen: readonly string[],
): DatabaseSplit {
  const kept: Database[] = [];
  const removed: Database[] = [];
  for (const [id, database] of Object.entries(manifest.databases)) {
    (chosen.includes(id) ? kept : removed).push(database);
  }
  return { kept, removed };
}

function parseJson(raw: string, file: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new DatabasePruneError(`Could not parse ${file}: ${reason}`);
  }
}

/** Removes one key path. A path that is not there is left alone. */
function deleteKeyPath(value: unknown, path: readonly string[]): boolean {
  let holder: unknown = value;
  for (const key of path.slice(0, -1)) {
    if (!isRecord(holder)) return false;
    holder = holder[key];
  }
  const last = path[path.length - 1];
  if (!isRecord(holder) || !(last in holder)) return false;
  delete holder[last];
  return true;
}

/** Every package manifest of the project, the root one included. */
async function packageManifests(root: string): Promise<string[]> {
  return (await listFiles(root)).filter(
    (file) => file === PACKAGE_MANIFEST || file.endsWith(`/${PACKAGE_MANIFEST}`),
  );
}

function dropPackages(manifest: Record<string, unknown>, packages: ReadonlySet<string>): boolean {
  let changed = false;
  for (const group of PACKAGE_DEPENDENCY_GROUPS) {
    const declared = manifest[group];
    if (!isRecord(declared)) continue;
    const kept = Object.entries(declared).filter(([name]) => !packages.has(name));
    if (kept.length === Object.keys(declared).length) continue;
    manifest[group] = Object.fromEntries(kept);
    changed = true;
  }
  return changed;
}

function dropScripts(manifest: Record<string, unknown>, scripts: ReadonlySet<string>): boolean {
  if (!isRecord(manifest.scripts)) return false;
  const kept = Object.entries(manifest.scripts).filter(([name]) => !scripts.has(name));
  if (kept.length === Object.keys(manifest.scripts).length) return false;
  manifest.scripts = Object.fromEntries(kept);
  return true;
}

/**
 * Takes what the databases left out own out of the JSON files: their
 * dependencies from every package manifest, their backend commands, and the
 * keys they list. Answers the files it rewrote.
 */
export async function removeDatabaseJson(root: string, removed: Database[]): Promise<string[]> {
  const packages = new Set(removed.flatMap((database) => database.packages));
  const scripts = new Set(removed.flatMap((database) => database.scripts));
  const keyPaths = new Map<string, string[][]>();
  for (const database of removed) {
    for (const [file, paths] of Object.entries(database.jsonKeys)) {
      keyPaths.set(file, [...(keyPaths.get(file) ?? []), ...paths]);
    }
  }

  const files = new Set([...(await packageManifests(root)), ...keyPaths.keys()]);
  const edited: string[] = [];
  for (const file of [...files].sort()) {
    const raw = await readFileIfExists(join(root, file));
    if (raw === undefined) continue;
    const parsed = parseJson(raw, file);
    if (!isRecord(parsed)) continue;

    let changed = false;
    if (file.endsWith(PACKAGE_MANIFEST)) changed = dropPackages(parsed, packages) || changed;
    if (file === DATABASE_SCRIPTS_MANIFEST) changed = dropScripts(parsed, scripts) || changed;
    for (const path of keyPaths.get(file) ?? []) changed = deleteKeyPath(parsed, path) || changed;
    if (!changed) continue;

    await writeFile(join(root, file), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    edited.push(file);
  }
  return edited;
}

/**
 * Gives the chosen database's files the plain names the other one left free.
 * A target that is still taken stops the run: it means the manifest and the
 * template no longer agree.
 */
export async function renameDatabaseFiles(root: string, kept: Database[]): Promise<string[]> {
  const moved: string[] = [];
  for (const database of kept) {
    for (const [from, to] of Object.entries(database.renames)) {
      // An option that was left out may have taken the file with it. A rename
      // whose source the template never carried is refused when it is built.
      if ((await readFileIfExists(join(root, from))) === undefined) continue;
      if ((await readFileIfExists(join(root, to))) !== undefined) {
        throw new DatabasePruneError(
          `${database.label} renames "${from}" to "${to}", which is still there`,
        );
      }
      await mkdir(dirname(join(root, to)), { recursive: true });
      await rename(join(root, from), join(root, to));
      moved.push(to);
    }
  }
  return moved;
}

async function applyRewrite(
  root: string,
  files: readonly string[],
  rewrite: DatabaseRewrite,
): Promise<string[]> {
  const edited: string[] = [];
  for (const file of files.filter((candidate) => matchesAnyGlob(candidate, rewrite.files))) {
    const content = await readFileIfExists(join(root, file));
    if (content === undefined || !content.includes(rewrite.from)) continue;
    await writeFile(join(root, file), content.split(rewrite.from).join(rewrite.to), 'utf8');
    edited.push(file);
  }
  return edited;
}

/**
 * Replaces text that told the chosen database apart from the other one. A
 * rule whose text is not there is skipped: an option or a client that was left
 * out may have taken the text with it. A rule whose text the template never
 * carried is caught by the installer's own tests, not here.
 */
export async function rewriteDatabaseText(root: string, kept: Database[]): Promise<string[]> {
  const edited = new Set<string>();
  const files = await listFiles(root);
  for (const database of kept) {
    for (const rewrite of database.rewrites) {
      for (const file of await applyRewrite(root, files, rewrite)) edited.add(file);
    }
  }
  return [...edited].sort();
}

const ENV_KEY = /^\s*#?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/**
 * Adds the chosen database's settings to the environment examples that exist.
 * A line the example already carries for one of those settings, commented out
 * or not, is replaced, so a setting is never there twice.
 */
export async function writeDatabaseEnvExamples(root: string, kept: Database[]): Promise<string[]> {
  const edited: string[] = [];
  for (const database of kept) {
    for (const example of database.envExamples) {
      const path = join(root, example.path);
      const content = await readFileIfExists(path);
      if (content === undefined) continue;
      const added = new Set(example.lines.flatMap((line) => ENV_KEY.exec(line)?.[1] ?? []));
      const body = content
        .split('\n')
        .filter((line) => !added.has(ENV_KEY.exec(line)?.[1] ?? ''))
        .join('\n')
        .replace(/\n+$/, '');
      await writeFile(path, `${body}\n\n${example.lines.join('\n')}\n`, 'utf8');
      edited.push(example.path);
    }
  }
  return edited;
}
