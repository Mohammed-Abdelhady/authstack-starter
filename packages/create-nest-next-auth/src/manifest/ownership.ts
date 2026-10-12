import { WEB_TARGET_ID } from '../constants/index.js';
import type { Manifest } from '../types.js';
import { defaultTargetIds } from './dimensions.js';
import type { Plan } from './plan-types.js';

/** What the chosen clients keep, and what goes with the ones left out. */
export interface Ownership {
  /** Globs owned by a target or shared module that is not part of the plan. */
  removedFiles: string[];
  /** Target and shared ids whose marked lines stay. */
  keptIds: string[];
  /** Every target and shared id, each one a valid marker name. */
  knownIds: string[];
}

type ClientChoice = Pick<Plan, 'targets' | 'shared' | 'signInSite'>;

/**
 * A target or shared module owns its files: they are removed when it is left
 * out, and a planned target is always left out. The web app is the exception
 * while a mobile app needs its sign-in pages.
 */
export function resolveOwnership(manifest: Manifest, choice: ClientChoice): Ownership {
  const keptTargets = new Set(choice.targets);
  if (choice.signInSite === 'kept-for-native') keptTargets.add(WEB_TARGET_ID);
  const keptShared = new Set(choice.shared);

  const removedFiles: string[] = [];
  for (const [id, target] of Object.entries(manifest.targets)) {
    if (!keptTargets.has(id)) removedFiles.push(...target.files, ...target.envFiles);
  }
  for (const [id, shared] of Object.entries(manifest.shared)) {
    if (!keptShared.has(id)) removedFiles.push(...shared.files);
  }

  return {
    removedFiles,
    keptIds: [
      ...Object.keys(manifest.targets).filter((id) => keptTargets.has(id)),
      ...Object.keys(manifest.shared).filter((id) => keptShared.has(id)),
    ],
    knownIds: [...Object.keys(manifest.targets), ...Object.keys(manifest.shared)],
  };
}

/** The ownership of a run that named no clients: the manifest defaults and nothing shared. */
export function defaultOwnership(manifest: Manifest): Ownership {
  return resolveOwnership(manifest, {
    targets: defaultTargetIds(manifest),
    shared: [],
    signInSite: 'full',
  });
}
