import type { Feature, FeatureStatus, Manifest } from '../types.js';

export interface FeatureEntry {
  id: string;
  feature: Feature;
}

export interface Selection {
  /** Selected ids plus everything they require, in manifest order. */
  selected: string[];
}

/** The single planned/available check shared by every dimension. */
export function isAvailable(entry: { status?: FeatureStatus }): boolean {
  return entry.status !== 'planned';
}

/** A mobile app signs in through the browser, so it is the target that needs the sign-in site. */
export function isMobileTarget(target: { needsSignInSite?: boolean } | undefined): boolean {
  return target?.needsSignInSite === true;
}

export function availableFeatures(manifest: Manifest): FeatureEntry[] {
  return Object.entries(manifest.features)
    .filter(([, feature]) => isAvailable(feature))
    .map(([id, feature]) => ({ id, feature }));
}

export function defaultFeatureIds(manifest: Manifest): string[] {
  return availableFeatures(manifest)
    .filter(({ feature }) => feature.default)
    .map(({ id }) => id);
}

/** Expands requested ids with their requirements. Callers validate the ids first. */
export function resolveSelection(manifest: Manifest, requested: string[]): Selection {
  const available = new Set(availableFeatures(manifest).map(({ id }) => id));
  const chosen = new Set(requested.filter((id) => available.has(id)));

  const queue = [...chosen];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    for (const required of manifest.features[id]?.requires ?? []) {
      if (!available.has(required) || chosen.has(required)) continue;
      chosen.add(required);
      queue.push(required);
    }
  }

  const order = availableFeatures(manifest).map(({ id }) => id);
  return { selected: order.filter((id) => chosen.has(id)) };
}
