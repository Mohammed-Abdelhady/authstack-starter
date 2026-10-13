import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BACKEND_PACKAGE_JSON, PACKAGE_DEPENDENCY_GROUPS } from '../constants/index.js';
import { isRecord } from '../manifest/read.js';
import type { Database, DatabaseRewrite, Manifest } from '../types.js';
import { isPackageManifest, listFiles, readFileIfExists } from '../utils/fs.js';
import { matchesAnyGlob } from '../utils/glob.js';
import { parseJson } from '../utils/parse-json.js';
import { ASSIGNMENT } from './env.js';
import { prunePackageDependencies } from './package-scripts.js';

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

function dropScripts(
  manifest: Record<string, unknown>,
  scripts: ReadonlySet<string>,
): Record<string, unknown> {
  if (!isRecord(manifest.scripts)) return manifest;
  const kept = Object.entries(manifest.scripts).filter(([name]) => !scripts.has(name));
  if (kept.length === Object.keys(manifest.scripts).length) return manifest;
  return { ...manifest, scripts: Object.fromEntries(kept) };
}

/** Gives a command its new name in place, so the order of the commands stays. */
function renameScripts(
  manifest: Record<string, unknown>,
  renames: Readonly<Record<string, string>>,
  label: string,
  report: ReportUnmatched,
): Record<string, unknown> {
  if (!isRecord(manifest.scripts)) return manifest;
  const scripts = manifest.scripts;
  let changed = false;
  for (const [from, to] of Object.entries(renames)) {
    if (!(from in scripts)) {
      report(`${label}: script "${from}" is not in ${BACKEND_PACKAGE_JSON}`);
      continue;
    }
    if (to in scripts) {
      throw new DatabasePruneError(
        `${label} renames the script "${from}" to "${to}", which is still there`,
      );
    }
    changed = true;
  }
  if (!changed) return manifest;
  return {
    ...manifest,
    scripts: Object.fromEntries(
      Object.entries(scripts).map(([name, command]) => [renames[name] ?? name, command]),
    ),
  };
}

function declaredPackages(manifest: Record<string, unknown>): string[] {
  return PACKAGE_DEPENDENCY_GROUPS.flatMap((group) => {
    const declared = manifest[group];
    return isRecord(declared) ? Object.keys(declared) : [];
  });
}

/** Told about each rule of a database that found nothing to change. */
export type ReportUnmatched = (rule: string) => void;

const ignoreUnmatched: ReportUnmatched = () => undefined;

/**
 * Takes what the databases left out own out of the JSON files: their
 * dependencies from every package manifest, their backend commands, and the
 * keys they list. Then gives the chosen database's commands the plain names.
 * Answers the files it rewrote.
 */
export async function removeDatabaseJson(
  root: string,
  removed: Database[],
  kept: Database[] = [],
  report: ReportUnmatched = ignoreUnmatched,
): Promise<string[]> {
  const packages = new Set(removed.flatMap((database) => database.packages));
  const scripts = new Set(removed.flatMap((database) => database.scripts));
  const keyPaths = new Map<string, string[][]>();
  for (const database of removed) {
    for (const [file, paths] of Object.entries(database.jsonKeys)) {
      keyPaths.set(file, [...(keyPaths.get(file) ?? []), ...paths]);
    }
  }

  const manifests = (await listFiles(root)).filter(isPackageManifest);
  const files = new Set([...manifests, ...keyPaths.keys()]);
  const seenPackages = new Set<string>();
  const seenScripts = new Set<string>();
  const edited: string[] = [];
  for (const file of [...files].sort()) {
    const raw = await readFileIfExists(join(root, file));
    const parsed = raw === undefined ? undefined : parseJson(raw, file);
    if (!isRecord(parsed)) {
      for (const path of keyPaths.get(file) ?? []) {
        report(`key ${path.join('.')} of ${file}: the file is not there`);
      }
      continue;
    }

    let updated = parsed;
    if (isPackageManifest(file)) {
      for (const name of declaredPackages(parsed)) seenPackages.add(name);
      updated = prunePackageDependencies(updated, packages);
    }
    if (file === BACKEND_PACKAGE_JSON) {
      for (const name of isRecord(parsed.scripts) ? Object.keys(parsed.scripts) : []) {
        seenScripts.add(name);
      }
      updated = dropScripts(updated, scripts);
      for (const database of kept) {
        updated = renameScripts(updated, database.scriptRenames, database.label, report);
      }
    }
    let changed = updated !== parsed;
    if (keyPaths.has(file)) {
      // Key paths are deleted in place, so the edit is made on a copy.
      const copy: unknown = structuredClone(updated);
      for (const path of keyPaths.get(file) ?? []) {
        if (deleteKeyPath(copy, path)) changed = true;
        else report(`key ${path.join('.')} of ${file} is not there`);
      }
      if (isRecord(copy)) updated = copy;
    }
    if (!changed) continue;

    await writeFile(join(root, file), `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
    edited.push(file);
  }
  for (const name of packages) {
    if (!seenPackages.has(name)) report(`package "${name}" is in no package manifest`);
  }
  for (const name of scripts) {
    if (!seenScripts.has(name)) report(`script "${name}" is not in ${BACKEND_PACKAGE_JSON}`);
  }
  return edited;
}

/**
 * Gives the chosen database's files the plain names the other one left free.
 * A target that is still taken stops the run: it means the manifest and the
 * template no longer agree.
 */
export async function renameDatabaseFiles(
  root: string,
  kept: Database[],
  report: ReportUnmatched = ignoreUnmatched,
): Promise<string[]> {
  const moved: string[] = [];
  for (const database of kept) {
    for (const [from, to] of Object.entries(database.renames)) {
      // An option that was left out may have taken the file with it. A rename
      // whose source the template never carried is refused when it is built.
      if ((await readFileIfExists(join(root, from))) === undefined) {
        report(`${database.label}: rename source "${from}" is not there`);
        continue;
      }
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
 * rule whose text is not there is skipped and reported: an option or a client
 * that was left out may have taken the text with it, so it is not an error.
 */
export async function rewriteDatabaseText(
  root: string,
  kept: Database[],
  report: ReportUnmatched = ignoreUnmatched,
): Promise<string[]> {
  const edited = new Set<string>();
  const files = await listFiles(root);
  for (const database of kept) {
    for (const rewrite of database.rewrites) {
      const changed = await applyRewrite(root, files, rewrite);
      if (changed.length === 0) {
        report(`${database.label}: no file holds the text ${JSON.stringify(rewrite.from)}`);
      }
      for (const file of changed) edited.add(file);
    }
  }
  return [...edited].sort();
}

/**
 * Adds the chosen database's settings to the environment examples that exist.
 * A line the example already carries for one of those settings, commented out
 * or not, is replaced, so a setting is never there twice.
 */
export async function writeDatabaseEnvExamples(
  root: string,
  kept: Database[],
  report: ReportUnmatched = ignoreUnmatched,
): Promise<string[]> {
  const edited: string[] = [];
  for (const database of kept) {
    for (const example of database.envExamples) {
      const path = join(root, example.path);
      const content = await readFileIfExists(path);
      if (content === undefined) {
        report(`${database.label}: environment example "${example.path}" is not there`);
        continue;
      }
      const added = new Set(example.lines.flatMap((line) => ASSIGNMENT.exec(line)?.[1] ?? []));
      const body = content
        .split('\n')
        .filter((line) => !added.has(ASSIGNMENT.exec(line)?.[1] ?? ''))
        .join('\n')
        .replace(/\n+$/, '');
      await writeFile(path, `${body}\n\n${example.lines.join('\n')}\n`, 'utf8');
      edited.push(example.path);
    }
  }
  return edited;
}
