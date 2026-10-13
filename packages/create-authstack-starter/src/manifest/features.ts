import type { Manifest, Preset } from '../types.js';
import { availableFeatures, defaultFeatureIds, isAvailable, resolveSelection } from './select.js';
import { type AddedLog, expandPresetValue, firstRequirer, unique } from './dimensions.js';
import type { PlanError, PlanRemoval, PlanRequest } from './plan-types.js';

export interface FeatureResult {
  chosen: Set<string>;
  removed: PlanRemoval[];
}

function requiresOf(manifest: Manifest, id: string): string[] {
  return manifest.features[id].requires;
}

function coversTargets(manifest: Manifest, id: string, chosenTargets: Set<string>): boolean {
  const limit = manifest.features[id].targets ?? [];
  return limit.length === 0 || limit.some((target) => chosenTargets.has(target));
}

/** Features a preset may select: available and not hidden (hidden ones arrive by requires). */
function requestableFeatureIds(manifest: Manifest): string[] {
  return availableFeatures(manifest)
    .filter(({ feature }) => feature.kind !== 'hidden')
    .map(({ id }) => id);
}

/**
 * The largest viable, requires-closed set the requested ids can support. Features
 * that do not cover the chosen clients are dropped, then anything that needed a
 * dropped feature, then requirements no surviving feature wants.
 */
function keepViable(
  manifest: Manifest,
  base: Set<string>,
  chosenTargets: Set<string>,
): Set<string> {
  const kept = new Set(base);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...kept]) {
      for (const required of requiresOf(manifest, id)) {
        if (isAvailable(manifest.features[required]) && !kept.has(required)) {
          kept.add(required);
          changed = true;
        }
      }
    }
  }

  changed = true;
  while (changed) {
    changed = false;
    for (const id of [...kept]) {
      const usable =
        coversTargets(manifest, id, chosenTargets) &&
        requiresOf(manifest, id).every((required) => kept.has(required));
      if (usable) continue;
      kept.delete(id);
      changed = true;
    }
    for (const id of [...kept]) {
      if (base.has(id)) continue;
      const wanted = [...kept].some(
        (other) => other !== id && requiresOf(manifest, other).includes(id),
      );
      if (wanted) continue;
      kept.delete(id);
      changed = true;
    }
  }

  return kept;
}

export function resolveFeatureSelection(
  manifest: Manifest,
  request: PlanRequest,
  preset: Preset | undefined,
  chosenTargets: Set<string>,
  added: AddedLog,
  errors: PlanError[],
): FeatureResult {
  const available = availableFeatures(manifest).map(({ id }) => id);
  const requested = unique(
    request.features ??
      (preset
        ? expandPresetValue(
            preset.features,
            requestableFeatureIds(manifest),
            defaultFeatureIds(manifest),
          )
        : defaultFeatureIds(manifest)),
  );

  const base = new Set<string>();
  for (const id of requested) {
    const feature = manifest.features[id];
    if (feature === undefined || feature.kind === 'hidden') {
      errors.push({ id, reason: 'unknown' });
      continue;
    }
    if (!isAvailable(feature)) {
      errors.push({ id, reason: 'planned' });
      continue;
    }
    base.add(id);
  }
  const explicit = new Set(request.features ?? []);

  const kept = keepViable(manifest, base, chosenTargets);
  const selected = resolveSelection(manifest, [...base]).selected;

  const removed: PlanRemoval[] = [];
  for (const id of selected) {
    if (kept.has(id)) continue;
    const limit = manifest.features[id].targets ?? [];
    const targetLimited = limit.length > 0 && !limit.some((target) => chosenTargets.has(target));
    const missing = requiresOf(manifest, id).find((required) => !kept.has(required));
    if (targetLimited) {
      removed.push({ id, reason: 'targets', because: limit.join(',') });
      if (explicit.has(id)) errors.push({ id, reason: 'feature-conflict' });
      continue;
    }
    if (missing !== undefined) {
      removed.push({ id, reason: 'needs', because: missing });
      if (explicit.has(id)) errors.push({ id, needed: missing, reason: 'feature-conflict' });
    }
    // Otherwise it was only pulled in by a feature that is gone: dropped quietly.
  }

  for (const id of available) {
    if (kept.has(id) && !base.has(id)) {
      added.record(
        id,
        firstRequirer(manifest.features, kept, id, (feature) => feature.requires),
      );
    }
  }

  return { chosen: kept, removed };
}
