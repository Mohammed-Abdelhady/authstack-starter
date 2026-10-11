import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATABASE_CHOICE_MARKER_ID } from '../../src/constants/index.js';
import { loadManifest } from '../../src/manifest/load.js';
import type { Manifest } from '../../src/types.js';
import { listFiles } from '../../src/utils/fs.js';

export const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));
const BACKEND_SOURCE = /^backend\/(?:src|test)\/.*\.(?:ts|mts|mjs)$/;

export interface OwnershipSource {
  manifest: Manifest;
  /** Every backend source and test file the repository carries. */
  backendFiles: string[];
}

export async function readOwnershipSource(): Promise<OwnershipSource> {
  return {
    manifest: await loadManifest(REPOSITORY),
    backendFiles: (await listFiles(join(REPOSITORY, 'backend')))
      .map((file) => `backend/${file}`)
      .filter((file) => BACKEND_SOURCE.test(file)),
  };
}

/** Every id a marker may name, and the ones a full project of one database keeps. */
export function markerIds(
  manifest: Manifest,
  database: string,
): { kept: Set<string>; known: Set<string> } {
  const shared = [
    ...Object.keys(manifest.features),
    ...Object.keys(manifest.options),
    ...Object.keys(manifest.targets),
    ...Object.keys(manifest.shared),
  ];
  return {
    kept: new Set([...shared, database]),
    known: new Set([...shared, ...Object.keys(manifest.databases), DATABASE_CHOICE_MARKER_ID]),
  };
}

/** What a project of one database deletes whatever else was picked. */
export function removedGlobs(manifest: Manifest, database: string): string[] {
  const others = Object.entries(manifest.databases).filter(([id]) => id !== database);
  return [...manifest.core.alwaysRemoveFiles, ...others.flatMap(([, entry]) => entry.files)];
}
