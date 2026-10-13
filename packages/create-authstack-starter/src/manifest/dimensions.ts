import type { FeatureStatus, Manifest, PresetValue } from '../types.js';
import type { PlanChange } from './plan-types.js';
import { DATABASE_CHOICE_MARKER_ID } from '../constants/index.js';
import { isAvailable } from './select.js';

/** Removes duplicates while keeping the first occurrence. */
export function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

function availableIds<T extends { status?: FeatureStatus }>(records: Record<string, T>): string[] {
  return Object.keys(records).filter((id) => isAvailable(records[id]));
}

function defaultIds<T extends { status?: FeatureStatus; default: boolean }>(
  records: Record<string, T>,
): string[] {
  return availableIds(records).filter((id) => records[id].default);
}

export function availableTargetIds(manifest: Manifest): string[] {
  return availableIds(manifest.targets);
}

export function defaultTargetIds(manifest: Manifest): string[] {
  return defaultIds(manifest.targets);
}

export function availableDatabaseIds(manifest: Manifest): string[] {
  return availableIds(manifest.databases);
}

export function defaultDatabaseIds(manifest: Manifest): string[] {
  return defaultIds(manifest.databases);
}

/**
 * Every database id, planned ones included. Each is a marker name: a line
 * marked for a database that was not chosen is removed with it. The choice
 * between databases is one more name, and it is never kept: a project carries
 * one database, so what only chooses between two has nothing left to do.
 */
export function databaseMarkerIds(manifest: Manifest): string[] {
  return [...Object.keys(manifest.databases), DATABASE_CHOICE_MARKER_ID];
}

export function availableOptionIds(manifest: Manifest): string[] {
  return availableIds(manifest.options);
}

export function defaultOptionIds(manifest: Manifest): string[] {
  return defaultIds(manifest.options);
}

/** Resolves a preset list to the available/default ids, dropping planned entries. */
export function expandPresetValue(
  value: PresetValue,
  available: string[],
  defaults: string[],
): string[] {
  if (value === 'available') return [...available];
  if (value === 'defaults') return [...defaults];
  const allowed = new Set(available);
  return value.filter((id) => allowed.has(id));
}

/** The first chosen record that names `id` through `requiresOf`, for reporting. */
export function firstRequirer<T>(
  records: Record<string, T>,
  chosen: Set<string>,
  id: string,
  requiresOf: (entry: T) => string[],
): string {
  for (const [recordId, entry] of Object.entries(records)) {
    if (!chosen.has(recordId)) continue;
    if (requiresOf(entry).includes(id)) return recordId;
  }
  return id;
}

/** Adds every requirement of the chosen records that is allowed, until nothing changes. */
export function expandRequires<T>(
  records: Record<string, T>,
  chosen: Set<string>,
  allowed: Set<string>,
  requiresOf: (entry: T) => string[],
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, entry] of Object.entries(records)) {
      if (!chosen.has(id)) continue;
      for (const required of requiresOf(entry)) {
        if (!allowed.has(required) || chosen.has(required)) continue;
        chosen.add(required);
        changed = true;
      }
    }
  }
}

/** Keeps the first reason an id was pulled in, for a stable added list. */
export class AddedLog {
  private readonly entries: PlanChange[] = [];
  private readonly seen = new Set<string>();

  record(id: string, because: string): void {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.entries.push({ id, because });
  }

  list(): PlanChange[] {
    return this.entries;
  }
}
