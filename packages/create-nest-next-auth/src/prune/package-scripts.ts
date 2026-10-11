import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PACKAGE_DEPENDENCY_GROUPS, ROOT_PACKAGE_JSON } from '../constants/index.js';
import TEMPLATE_TEST_POLICY from '../constants/template-tests.json' with { type: 'json' };
import { isRecord } from '../manifest/read.js';
import { isPackageManifest, listFiles, readFileIfExists } from '../utils/fs.js';
import { parseJson } from '../utils/parse-json.js';
import { workspaceDirectories } from '../scaffold/workspace.js';

const REPOSITORY_TEST_PATHS = TEMPLATE_TEST_POLICY.EXCLUDED_PATH_PATTERNS.map(
  (pattern) => new RegExp(pattern),
);

/** Removes a leading `./` so a command token matches a manifest path. */
function asPath(token: string): string {
  return token.startsWith('./') ? token.slice(2) : token;
}

/** True when a `node --test` list has no test file left after the filter. */
function hasTestFile(tokens: string[]): boolean {
  return tokens.some((token, index) => index > 1 && !token.startsWith('-') && token !== 'node');
}

/** A shell operator other than a simple `&&` chain. */
const OTHER_SHELL_OPERATOR = /(\|\||;|\|(?!=)|(?<!&)&(?!&))/;

/**
 * Drops deleted files and repository-only tests from generated commands.
 * Other tests and scripts keep the feature-pruner's existing behavior.
 */
export function prunePackageScripts(
  packageJson: Record<string, unknown>,
  deletedFiles: readonly string[],
): Record<string, unknown> {
  if (!isRecord(packageJson.scripts)) return packageJson;

  const deleted = new Set(deletedFiles);
  const isDeleted = (token: string): boolean =>
    deleted.has(asPath(token)) ||
    REPOSITORY_TEST_PATHS.some((pattern) => pattern.test(asPath(token)));
  const namesDeleted = (command: string): boolean => command.split(/\s+/).some(isDeleted);
  const scripts: Record<string, unknown> = {};

  for (const [name, command] of Object.entries(packageJson.scripts)) {
    if (typeof command !== 'string' || !namesDeleted(command)) {
      scripts[name] = command;
      continue;
    }

    const tokens = command.split(/\s+/);
    if (tokens.includes('--test')) {
      const kept = tokens.filter((token) => !isDeleted(token));
      if (!hasTestFile(kept)) continue;
      scripts[name] = kept.join(' ');
      continue;
    }

    if (command.includes('&&')) {
      const kept = command.split(' && ').filter((part) => !namesDeleted(part));
      if (kept.length === 0) continue;
      scripts[name] = kept.join(' && ');
      continue;
    }

    if (OTHER_SHELL_OPERATOR.test(command)) {
      throw new Error(
        `Script "${name}" mixes a deleted file with shell operators; edit it by hand.`,
      );
    }

    // A single command that exists to run a deleted file goes with it.
  }

  if (
    scripts['test:config:all'] !== undefined &&
    scripts['test:config:all'] === scripts['test:config']
  )
    delete scripts['test:config:all'];

  return { ...packageJson, scripts };
}

export function prunePackageWorkspaces(
  packageJson: Record<string, unknown>,
  directories: readonly string[],
): Record<string, unknown> {
  if (!Array.isArray(packageJson.workspaces)) return packageJson;
  return { ...packageJson, workspaces: [...directories] };
}

export function prunePackageDependencies(
  packageJson: Record<string, unknown>,
  unavailableWorkspaceNames: ReadonlySet<string>,
): Record<string, unknown> {
  let changed = false;
  const updated = { ...packageJson };
  for (const group of PACKAGE_DEPENDENCY_GROUPS) {
    const dependencies = packageJson[group];
    if (!isRecord(dependencies)) continue;
    const kept = Object.fromEntries(
      Object.entries(dependencies).filter(([name]) => !unavailableWorkspaceNames.has(name)),
    );
    if (Object.keys(kept).length !== Object.keys(dependencies).length) {
      updated[group] = kept;
      changed = true;
    }
  }
  return changed ? updated : packageJson;
}

/** Applies the typed transform to a generated root package.json. */
export async function pruneRootPackage(
  root: string,
  deletedFiles: readonly string[],
): Promise<boolean> {
  const path = join(root, ROOT_PACKAGE_JSON);
  const raw = await readFileIfExists(path);
  if (raw === undefined) return false;

  const parsed = parseJson(raw, ROOT_PACKAGE_JSON);
  if (!isRecord(parsed)) return false;

  const existingFiles = await listFiles(root);
  const directories = await workspaceDirectories(root);
  const withScripts = prunePackageScripts(parsed, deletedFiles);
  const withWorkspaces = prunePackageWorkspaces(withScripts, directories);
  const unavailableWorkspaceNames = await findUnavailableWorkspaceNames(
    root,
    existingFiles,
    directories,
  );
  const updated = prunePackageDependencies(withWorkspaces, unavailableWorkspaceNames);
  let changed = JSON.stringify(updated) !== JSON.stringify(parsed);
  if (changed) await writeFile(path, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');

  for (const file of existingFiles.filter((entry) => entry.endsWith('/package.json'))) {
    const nestedPath = join(root, file);
    const nestedRaw = await readFileIfExists(nestedPath);
    if (nestedRaw === undefined) continue;
    const nested = parseJson(nestedRaw, file);
    if (!isRecord(nested)) continue;
    const pruned = prunePackageDependencies(nested, unavailableWorkspaceNames);
    if (pruned === nested) continue;
    await writeFile(nestedPath, `${JSON.stringify(pruned, null, 2)}\n`, 'utf8');
    changed = true;
  }
  return changed;
}

async function findUnavailableWorkspaceNames(
  root: string,
  files: readonly string[],
  directories: readonly string[],
): Promise<Set<string>> {
  const workspaceManifests = new Set(directories.map((directory) => `${directory}/package.json`));
  const available = new Set<string>();
  const referenced = new Set<string>();

  for (const file of files.filter(isPackageManifest)) {
    const raw = await readFileIfExists(join(root, file));
    if (raw === undefined) continue;
    const value = parseJson(raw, file);
    if (!isRecord(value)) continue;

    if (workspaceManifests.has(file)) {
      if (typeof value.name === 'string') available.add(value.name);
    }
    for (const group of PACKAGE_DEPENDENCY_GROUPS) {
      const dependencies = value[group];
      if (!isRecord(dependencies)) continue;
      for (const [name, version] of Object.entries(dependencies)) {
        if (typeof version === 'string' && version.startsWith('workspace:')) referenced.add(name);
      }
    }
  }

  return new Set([...referenced].filter((name) => !available.has(name)));
}
