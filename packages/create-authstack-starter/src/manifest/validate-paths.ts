import type { Manifest } from '../types.js';
import { ManifestError } from './validate.js';
import { manifestPathProblems } from '../../scripts/manifest-paths.mjs';
export { manifestPathProblems } from '../../scripts/manifest-paths.mjs';

/** Throws ManifestError listing every path that matches no tracked file. */
export function validateManifestPaths(manifest: Manifest, tracked: readonly string[]): void {
  const problems = manifestPathProblems(manifest, tracked);
  if (problems.length > 0) throw new ManifestError(problems);
}
