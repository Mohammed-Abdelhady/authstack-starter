import type { FeatureStatus } from '../types.js';
import { DATABASE_CHOICE_MARKER_ID, PACKAGE_MANIFEST } from '../constants/index.js';
import { matchesAnyGlob } from '../utils/glob.js';
import { isAvailable } from './select.js';
import type { Dimensions } from './validate-dimensions.js';

/** Checks that every `requires` id exists and that an available entry does not need a planned one. */
export function checkRequires<T extends { status?: FeatureStatus; requires: string[] }>(
  records: Record<string, T>,
  where: string,
  problems: string[],
  noun: string,
): void {
  for (const [id, entry] of Object.entries(records)) {
    for (const required of entry.requires) {
      const target = records[required];
      if (!target) {
        problems.push(`${where}.${id}.requires names "${required}", which does not exist`);
        continue;
      }
      if (isAvailable(entry) && !isAvailable(target)) {
        problems.push(`${where}.${id} is available but requires planned ${noun} "${required}"`);
      }
    }
  }
}

function checkTargets(dimensions: Dimensions, problems: string[]): void {
  for (const [id, target] of Object.entries(dimensions.targets)) {
    for (const shared of target.requires.shared) {
      if (!dimensions.shared[shared]) {
        problems.push(`targets.${id}.requires.shared names "${shared}", which does not exist`);
      }
    }
    for (const required of target.requires.targets) {
      const referenced = dimensions.targets[required];
      if (!referenced) {
        problems.push(`targets.${id}.requires.targets names "${required}", which does not exist`);
        continue;
      }
      if (isAvailable(target) && !isAvailable(referenced)) {
        problems.push(`targets.${id} is available but requires planned target "${required}"`);
      }
    }
  }
}

function checkPresets(dimensions: Dimensions, featureIds: string[], problems: string[]): void {
  const known: Record<string, Set<string>> = {
    targets: new Set(Object.keys(dimensions.targets)),
    features: new Set(featureIds),
    options: new Set(Object.keys(dimensions.options)),
  };
  for (const [id, preset] of Object.entries(dimensions.presets)) {
    for (const dimension of ['targets', 'features', 'options'] as const) {
      const value = preset[dimension];
      if (!Array.isArray(value)) continue;
      for (const entry of value) {
        if (!known[dimension].has(entry)) {
          problems.push(`presets.${id}.${dimension} names "${entry}", which does not exist`);
        }
      }
    }
  }
}

function checkUniqueIds(dimensions: Dimensions, featureIds: string[], problems: string[]): void {
  const groups: [string, string[]][] = [
    ['targets', Object.keys(dimensions.targets)],
    ['shared', Object.keys(dimensions.shared)],
    ['databases', Object.keys(dimensions.databases)],
    ['options', Object.keys(dimensions.options)],
    ['features', featureIds],
  ];
  // The marker for lines that only choose between databases is no one's id.
  const seen = new Map<string, string>([[DATABASE_CHOICE_MARKER_ID, 'the database choice marker']]);
  for (const [dimension, ids] of groups) {
    for (const id of ids) {
      const first = seen.get(id);
      if (first === undefined) seen.set(id, dimension);
      else problems.push(`id "${id}" is used by both ${first} and ${dimension}`);
    }
  }
}

function checkDefaults(dimensions: Dimensions, problems: string[]): void {
  const targets = Object.keys(dimensions.targets).filter((id) =>
    isAvailable(dimensions.targets[id]),
  );
  if (targets.length === 0) problems.push('targets must define at least one available id');
  if (targets.filter((id) => dimensions.targets[id].default).length === 0) {
    problems.push('targets must define at least one available default');
  }

  const databases = Object.keys(dimensions.databases).filter((id) =>
    isAvailable(dimensions.databases[id]),
  );
  if (databases.length === 0) problems.push('databases must define at least one available id');
  const defaultDatabases = databases.filter((id) => dimensions.databases[id].default);
  if (defaultDatabases.length !== 1) {
    const found =
      defaultDatabases.length === 0 ? 'none' : defaultDatabases.map((id) => `"${id}"`).join(', ');
    problems.push(`databases must define exactly one available default, got ${found}`);
  }
}

function rejectPlannedFiles(
  where: string,
  id: string,
  status: FeatureStatus | undefined,
  lists: string[][],
  problems: string[],
): void {
  if (status !== 'planned') return;
  if (lists.some((list) => list.length > 0)) {
    problems.push(`${where}.${id} is planned and must not list files yet`);
  }
}

/**
 * A workspace an owner lists has to sit under the files it owns, or leaving the
 * owner out would delete nothing and keep the workspace.
 */
function checkOwnedWorkspaces(dimensions: Dimensions, problems: string[]): void {
  const owners: [string, { files: string[]; workspaces: string[] }][] = [
    ...Object.entries(dimensions.targets).map(([id, target]): [string, typeof target] => [
      `targets.${id}`,
      target,
    ]),
    ...Object.entries(dimensions.shared).map(([id, shared]): [string, typeof shared] => [
      `shared.${id}`,
      shared,
    ]),
  ];
  for (const [where, owner] of owners) {
    if (owner.files.length === 0) continue;
    for (const workspace of owner.workspaces) {
      if (!matchesAnyGlob(`${workspace}/${PACKAGE_MANIFEST}`, owner.files)) {
        problems.push(`${where}.workspaces names "${workspace}", which its files do not cover`);
      }
    }
  }
}

// A planned target may own files: it is never part of a plan, so they are always removed.
function checkPlannedFiles(dimensions: Dimensions, problems: string[]): void {
  for (const [id, database] of Object.entries(dimensions.databases)) {
    rejectPlannedFiles(
      'databases',
      id,
      database.status,
      [
        database.files,
        database.docs,
        database.envVars,
        database.packages,
        database.scripts,
        database.buildApprovals,
        Object.keys(database.jsonKeys),
        Object.keys(database.renames),
        Object.keys(database.scriptRenames),
        database.rewrites.map((rewrite) => rewrite.from),
        database.envExamples.map((example) => example.path),
      ],
      problems,
    );
  }
  for (const [id, option] of Object.entries(dimensions.options)) {
    rejectPlannedFiles('options', id, option.status, [option.files, option.docs], problems);
  }
}

/** Cross-checks targets, options, presets and id namespaces once everything is read. */
export function checkDimensions(
  dimensions: Dimensions,
  featureIds: string[],
  problems: string[],
): void {
  checkTargets(dimensions, problems);
  checkRequires(dimensions.options, 'options', problems, 'option');
  checkPresets(dimensions, featureIds, problems);
  checkUniqueIds(dimensions, featureIds, problems);
  checkDefaults(dimensions, problems);
  checkPlannedFiles(dimensions, problems);
  checkOwnedWorkspaces(dimensions, problems);
}
