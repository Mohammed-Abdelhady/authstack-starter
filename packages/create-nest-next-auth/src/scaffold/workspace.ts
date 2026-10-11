import { readFile, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { parseDocument } from 'yaml';
import { PACKAGE_MANIFEST, PNPM_WORKSPACE_FILE } from '../constants/index.js';
import { isRecord } from '../manifest/read.js';
import { isErrnoException, isPackageManifest, listFiles } from '../utils/fs.js';
import { matchesAnyGlob } from '../utils/glob.js';

interface WorkspaceDocument {
  document: ReturnType<typeof parseDocument>;
  packages: string[];
}

async function readWorkspace(root: string): Promise<WorkspaceDocument | undefined> {
  const path = join(root, PNPM_WORKSPACE_FILE);
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }

  const document = parseDocument(source);
  if (document.errors.length > 0) throw document.errors[0];
  const config: unknown = document.toJS();
  if (
    !isRecord(config) ||
    !Array.isArray(config.packages) ||
    !config.packages.every((pattern: unknown): pattern is string => typeof pattern === 'string')
  ) {
    throw new Error('The template has an invalid pnpm workspace list.');
  }
  return { document, packages: config.packages };
}

/** Expands the workspace patterns pnpm reads into folders with manifests. */
export async function workspaceDirectories(root: string): Promise<string[]> {
  const workspace = await readWorkspace(root);
  if (workspace === undefined) return [];
  const patterns = workspace.packages.map((pattern) => `${pattern}/${PACKAGE_MANIFEST}`);
  const files = await listFiles(root);
  return [
    ...new Set(
      files.filter((file) => matchesAnyGlob(file, patterns)).map((file) => posix.dirname(file)),
    ),
  ].sort();
}

/** The named build approvals the workspace file carries. */
function presentApprovals(config: unknown, names: readonly string[]): string[] {
  if (!isRecord(config) || !isRecord(config.allowBuilds)) return [];
  const approvals = config.allowBuilds;
  return names.filter((name) => name in approvals);
}

/**
 * Keeps security settings, lists only workspaces left in the scaffold, and
 * drops the build approvals of tooling the project does not install.
 */
export async function renderWorkspace(
  root: string,
  unusedApprovals: readonly string[] = [],
): Promise<boolean> {
  const workspace = await readWorkspace(root);
  if (workspace === undefined) return false;
  const manifests = (await listFiles(root)).filter(isPackageManifest);
  const packages = workspace.packages.filter((pattern) =>
    manifests.some((file) => matchesAnyGlob(file, [`${pattern}/${PACKAGE_MANIFEST}`])),
  );
  const approvals = presentApprovals(workspace.document.toJS(), unusedApprovals);
  const packagesChanged = packages.length !== workspace.packages.length;
  if (!packagesChanged && approvals.length === 0) return false;

  if (packagesChanged) workspace.document.set('packages', packages);
  for (const name of approvals) workspace.document.deleteIn(['allowBuilds', name]);
  await writeFile(join(root, PNPM_WORKSPACE_FILE), workspace.document.toString(), 'utf8');
  return true;
}
