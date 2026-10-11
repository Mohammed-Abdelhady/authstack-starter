import type { Manifest, PruneResult, RulesPolicy } from '../types.js';
import {
  DATABASE_CHOICE_ENV_VARS,
  DATABASE_CHOICE_WORDS,
  ENV_EXAMPLE_FILES,
  FRONTEND_PACKAGE_JSON,
  PNPM_WORKSPACE_FILE,
  ROOT_PACKAGE_JSON,
  DEFAULT_RULES_POLICY,
  RULES_POLICY,
} from '../constants/index.js';
import { databaseMarkerIds, defaultDatabaseIds } from '../manifest/dimensions.js';
import {
  removeDatabaseJson,
  renameDatabaseFiles,
  rewriteDatabaseText,
  splitDatabases,
  writeDatabaseEnvExamples,
} from './database.js';
import { defaultOwnership, type Ownership } from '../manifest/ownership.js';
import { isAvailable } from '../manifest/select.js';
import { pruneIgnoreFile } from './ignore-file.js';
import { pruneLintStaged } from './lint-staged.js';
import { pruneRules } from './rules.js';
import { removeDocMarkers } from './doc-markers.js';
import { removeHashMarkers } from './hash-markers.js';
import { removeDocLinks } from './docs.js';
import { DEPENDABOT_FILE, pruneDependabot } from './dependabot.js';
import { type EnvRemovals, stripEnvFiles, writeFeatureFlag } from './env.js';
import { deleteMatchingFiles } from './files.js';
import { formatChangedFiles } from './format.js';
import { removeFeatureLines } from './markers.js';
import { pruneMessageCatalogues } from './messages.js';
import { pruneRootPackage } from './package-scripts.js';
import { renderWorkspace } from '../scaffold/workspace.js';
import { findDanglingReferences } from './references.js';

/**
 * Env vars only the removed features and databases use, mapped to the words
 * naming them. The setting that chooses between databases goes from every
 * project: a project carries one.
 */
function removedEnvVars(
  manifest: Manifest,
  selected: Set<string>,
  chosenDatabases: readonly string[],
): { removals: EnvRemovals; ofDatabases: Set<string> } {
  const keptVars = new Set<string>();
  for (const id of selected) {
    for (const name of manifest.features[id]?.envVars ?? []) keptVars.add(name);
  }

  const removals: EnvRemovals = new Map();
  for (const [id, feature] of Object.entries(manifest.features)) {
    if (selected.has(id)) continue;
    for (const name of feature.envVars) {
      if (keptVars.has(name)) continue;
      removals.set(name, [feature.label, id]);
    }
  }
  // A database's settings take their whole comment with them: it describes
  // addresses of a database the project does not have.
  const ofDatabases = new Set<string>();
  for (const [id, database] of Object.entries(manifest.databases)) {
    if (chosenDatabases.includes(id)) continue;
    for (const name of database.envVars) {
      removals.set(name, [database.label, id]);
      ofDatabases.add(name);
    }
  }
  for (const name of DATABASE_CHOICE_ENV_VARS) {
    removals.set(name, DATABASE_CHOICE_WORDS);
    ofDatabases.add(name);
  }
  return { removals, ofDatabases };
}

/**
 * Removes everything the unselected features, options and clients own, marked
 * lines and sections included, then reports imports and scripts into deleted
 * files and missing relative documentation links.
 */
export async function prune(
  root: string,
  manifest: Manifest,
  selectedFeatures: string[],
  selectedOptions: string[],
  rules: RulesPolicy = DEFAULT_RULES_POLICY,
  ownership: Ownership = defaultOwnership(manifest),
  databases: string[] = defaultDatabaseIds(manifest),
): Promise<PruneResult> {
  const selected = new Set(selectedFeatures);
  const removed = Object.keys(manifest.features).filter((id) => !selected.has(id));

  const keptOptions = new Set(selectedOptions);
  const removedOptions = Object.keys(manifest.options).filter((id) => !keptOptions.has(id));

  const doomedFiles: string[] = [];
  const doomedDocs: string[] = [];
  for (const id of removed) {
    const feature = manifest.features[id];
    doomedFiles.push(...feature.files);
    doomedDocs.push(...feature.docs);
  }
  for (const id of removedOptions) {
    const option = manifest.options[id];
    doomedFiles.push(...option.files);
    doomedDocs.push(...option.docs);
  }

  doomedFiles.push(...ownership.removedFiles);

  const { kept: keptDatabases, removed: removedDatabases } = splitDatabases(manifest, databases);
  for (const database of removedDatabases) {
    doomedFiles.push(...database.files);
    doomedDocs.push(...database.docs);
  }

  const deletedFiles = await deleteMatchingFiles(root, [
    ...manifest.core.alwaysRemoveFiles,
    ...doomedFiles,
    ...doomedDocs,
  ]);
  deletedFiles.push(...(await pruneRules(root, rules)));

  // Runs for every selection, not only a partial one: the full project has to
  // come out without marker comments too. Option, client, shared and database
  // ids are valid marker names.
  const markerIds = [
    ...Object.keys(manifest.features),
    ...Object.keys(manifest.options),
    ...ownership.knownIds,
    ...databaseMarkerIds(manifest),
  ];
  const keptIds = [...selectedFeatures, ...selectedOptions, ...ownership.keptIds, ...databases];
  const markers = await removeFeatureLines(root, keptIds, markerIds);
  const docMarkers = await removeDocMarkers(root, keptIds, markerIds);
  const hashMarkers = await removeHashMarkers(root, keptIds, markerIds);

  const removedMarkdown = deletedFiles.filter((path) => path.endsWith('.md'));
  const docs = await removeDocLinks(root, [...doomedDocs, ...removedMarkdown]);
  const envVars = removedEnvVars(manifest, selected, databases);
  const strippedEnvVars = await stripEnvFiles(root, envVars.removals, envVars.ofDatabases);
  await writeFeatureFlag(root, selectedFeatures);
  const unmatchedDatabaseRules: string[] = [];
  const unmatched = (rule: string): void => {
    unmatchedDatabaseRules.push(rule);
  };
  await writeDatabaseEnvExamples(root, keptDatabases, unmatched);
  const workspaceChanged = await renderWorkspace(
    root,
    removedDatabases.flatMap((database) => database.buildApprovals),
  );
  const databaseJson = await removeDatabaseJson(root, removedDatabases, keptDatabases, unmatched);
  const renamed = await renameDatabaseFiles(root, keptDatabases, unmatched);
  // A file one database gave up and the chosen one took the name of is there
  // again, so nothing that reads the deleted files may count it as gone.
  for (const name of renamed) {
    const at = deletedFiles.indexOf(name);
    if (at !== -1) deletedFiles.splice(at, 1);
  }
  await pruneRootPackage(root, deletedFiles);
  const rewritten = await rewriteDatabaseText(root, keptDatabases, unmatched);
  await pruneLintStaged(root);
  await pruneIgnoreFile(root, ownership.removedFiles);
  await pruneDependabot(root, deletedFiles);
  const editedCatalogues = await pruneMessageCatalogues(root, manifest, removedOptions);

  // The generated project's own prettier config, applied to every file the
  // pruner edited, so a fresh scaffold lints without a manual format run.
  const formattedFiles = await formatChangedFiles(root, [
    ...markers.editedFiles,
    ...docMarkers.editedFiles,
    ...docs.editedFiles,
    ...ENV_EXAMPLE_FILES,
    ...editedCatalogues,
    ROOT_PACKAGE_JSON,
    FRONTEND_PACKAGE_JSON,
    ...databaseJson,
    ...renamed,
    ...rewritten,
    ...(workspaceChanged ? [PNPM_WORKSPACE_FILE] : []),
    DEPENDABOT_FILE,
  ]);

  const dangling = await findDanglingReferences(root, deletedFiles);
  // Only something that was left out can take a rule's target with it.
  const everythingKept =
    removed.every((id) => !isAvailable(manifest.features[id])) &&
    removedOptions.length === 0 &&
    ownership.removedFiles.length === 0 &&
    rules === RULES_POLICY.STRICT;

  return {
    selected: selectedFeatures,
    removed,
    removedOptions,
    deletedFiles,
    strippedEnvVars,
    removedDocLines: docs.removedLines,
    markedFiles: [...markers.editedFiles, ...docMarkers.editedFiles, ...hashMarkers.editedFiles],
    removedMarkedLines: markers.removedLines + docMarkers.removedLines + hashMarkers.removedLines,
    formattedFiles,
    dangling,
    unmatchedDatabaseRules,
    unexplainedDatabaseRules: everythingKept ? unmatchedDatabaseRules : [],
  };
}
