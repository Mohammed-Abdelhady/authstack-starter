import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BACKEND_PACKAGE_JSON,
  BROWSER_STACK_PACKAGES,
  ENGINE_SUITE_PACKAGES,
  PLAYWRIGHT_SCRIPT_NAMES,
} from '../constants/index.js';
import { isRecord } from '../manifest/read.js';
import { readFileIfExists } from '../utils/fs.js';
import { toPackageName } from '../utils/project-name.js';

/** Names the generated project and removes commands for the maintainer browser harness. */
export async function setProjectName(root: string, projectName: string): Promise<string> {
  const path = join(root, 'package.json');
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) return projectName;

  const packageName = toPackageName(projectName);
  const updated = { ...(parsed as Record<string, unknown>), name: packageName };
  await writeFile(path, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  const frontendPath = join(root, 'frontend', 'package.json');
  const frontend = JSON.parse(await readFile(frontendPath, 'utf8')) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  for (const command of PLAYWRIGHT_SCRIPT_NAMES) {
    if (frontend.scripts) delete frontend.scripts[command];
  }
  for (const dependency of BROWSER_STACK_PACKAGES) {
    if (frontend.devDependencies) delete frontend.devDependencies[dependency];
  }
  await writeFile(frontendPath, `${JSON.stringify(frontend, null, 2)}\n`, 'utf8');
  await removeRepositoryOnlyPackages(root);
  return packageName;
}

/** Drops what only repository suites use from the backend: their files never ship. */
async function removeRepositoryOnlyPackages(root: string): Promise<void> {
  const backendPath = join(root, BACKEND_PACKAGE_JSON);
  const source = await readFileIfExists(backendPath);
  if (source === undefined) return;

  const backend: unknown = JSON.parse(source);
  if (!isRecord(backend)) return;
  if (!removeRepositoryOnlyTooling(backend)) return;
  await writeFile(backendPath, `${JSON.stringify(backend, null, 2)}\n`, 'utf8');
}

function removeRepositoryOnlyTooling(backend: Record<string, unknown>): boolean {
  if (!isRecord(backend.devDependencies)) return false;
  const repositoryOnly = new Set<string>(ENGINE_SUITE_PACKAGES);
  const declared = Object.entries(backend.devDependencies);
  const kept = declared.filter(([name]) => !repositoryOnly.has(name));
  if (kept.length === declared.length) return false;
  backend.devDependencies = Object.fromEntries(kept);
  return true;
}
