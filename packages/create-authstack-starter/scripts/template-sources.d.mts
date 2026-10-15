import type { Stats } from 'node:fs';

export type IsExcluded = (relativePath: string, name: string, isDirectory: boolean) => boolean;

/** A tracked path the copier ships, repository-relative with `/` separators. */
export interface SelectedSource {
  path: string;
  stats: Stats;
}

export function isExcludedPath(segments: string[], isExcluded: IsExcluded): boolean;
export function sourceStats(root: string, source: string): Promise<Stats | null>;
export function selectSources(
  root: string,
  trackedPaths: string[],
  isExcluded: IsExcluded,
): Promise<SelectedSource[]>;
