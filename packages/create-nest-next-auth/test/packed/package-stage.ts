import { copyFileSync, cpSync, existsSync, lstatSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExcluded, trackedFiles } from '../../scripts/sync-template.mjs';
import {
  MANIFEST_FILE,
  REWRITES_FILE,
  TEMPLATE_DIR_NAME,
  TEMPLATE_IDENTITY_FILE,
} from '../../src/constants/index.js';
import { fixtureGit } from '../support/sync-template-fixture.js';

export const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));
const REPO_ROOT = dirname(dirname(PACKAGE_DIR));
export const PACKAGE_PATH = relative(REPO_ROOT, PACKAGE_DIR);
const DEPENDENCIES_DIR = 'node_modules';
// What a build writes into the package folder. A leftover from an earlier
// build must not travel into a stage that is about to produce its own.
const GENERATED_INPUTS = new Set([
  TEMPLATE_DIR_NAME,
  MANIFEST_FILE,
  REWRITES_FILE,
  TEMPLATE_IDENTITY_FILE,
]);
// The stage borrows the package's installed dependencies and has no install
// of its own, so pnpm must not try to install the staged workspace before it
// runs the build.
export const STAGE_ENVIRONMENT = { pnpm_config_verify_deps_before_run: 'false' };

function shipsFrom(root: string, source: string): boolean {
  const path = relative(root, source);
  return path === '' || !isExcluded(path, basename(path), lstatSync(source).isDirectory());
}

/**
 * Makes the stage a repository that tracks what the source tracks. The build
 * ships only tracked files, so a stage without an index would ship nothing
 * and one that tracked everything would ship the source's untracked files.
 */
function trackLikeSource(workspace: string, stage: string, repoRoot: string): void {
  const tracked = trackedFiles(repoRoot).filter((path) => existsSync(join(stage, path)));
  const pathspec = join(workspace, 'stage-tracked-paths');
  writeFileSync(pathspec, tracked.join('\0'));
  fixtureGit(stage, ['init', '--quiet']);
  fixtureGit(stage, [
    '--literal-pathspecs',
    'add',
    '--force',
    `--pathspec-from-file=${pathspec}`,
    '--pathspec-file-nul',
  ]);
}

/**
 * Copies the repository and the installer package into `workspace` and returns
 * the staged package. The sync script resolves the repository from its own
 * location, so a build run there writes template/, the manifest, the identity
 * and dist/ into the stage and leaves the checked-out package folder alone.
 * The stage tracks the same files as the source, so the same files ship.
 */
export function stagePackage(workspace: string, repoRoot = REPO_ROOT): string {
  const stage = join(workspace, 'repository');
  cpSync(repoRoot, stage, { recursive: true, filter: (source) => shipsFrom(repoRoot, source) });
  copyFileSync(join(repoRoot, MANIFEST_FILE), join(stage, MANIFEST_FILE));
  // The rewrites travel with the manifest. A fixture repository may have none.
  if (existsSync(join(repoRoot, REWRITES_FILE))) {
    copyFileSync(join(repoRoot, REWRITES_FILE), join(stage, REWRITES_FILE));
  }

  const source = join(repoRoot, PACKAGE_PATH);
  const staged = join(stage, PACKAGE_PATH);
  cpSync(source, staged, {
    recursive: true,
    filter: (path) => !GENERATED_INPUTS.has(relative(source, path)) && shipsFrom(repoRoot, path),
  });
  // Tracked before the borrowed dependencies are linked in: Git refuses a
  // path that sits behind a symbolic link.
  trackLikeSource(workspace, stage, repoRoot);
  symlinkSync(join(source, DEPENDENCIES_DIR), join(staged, DEPENDENCIES_DIR), 'dir');
  return staged;
}
