// feature:database-choice:start
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripRemovedMarkers } from './account-creation-inventory-fixtures.harness-spec';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ownedPaths(database: 'mongodb' | 'postgres'): string[] {
  const manifest: unknown = JSON.parse(
    readFileSync(
      join(__dirname, '../../../../../template.manifest.json'),
      'utf8',
    ),
  );
  if (!isRecord(manifest) || !isRecord(manifest.databases)) {
    throw new Error('The template manifest has no database ownership map');
  }
  const entry = manifest.databases[database];
  if (!isRecord(entry) || !Array.isArray(entry.files)) {
    throw new Error(`The template manifest has no files for ${database}`);
  }
  if (!entry.files.every((path: unknown) => typeof path === 'string')) {
    throw new Error(
      `The template manifest has an invalid path for ${database}`,
    );
  }
  return entry.files.filter(
    (path: unknown): path is string => typeof path === 'string',
  );
}

/** The manifest uses literal paths and these four wildcard forms. */
function ownershipPattern(glob: string): RegExp {
  const pattern = glob
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map((part) => {
      if (part === '**/') return '(?:.*/)?';
      if (part === '**') return '.*';
      if (part === '*') return '[^/]*';
      if (part === '?') return '[^/]';
      return part.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${pattern}$`);
}

/** Use the generator's ownership map, including its named exceptions. */
export function withoutInventoryDatabase(
  documents: ReadonlyMap<string, string>,
  removed: 'mongodb' | 'postgres',
) {
  const owned = ownedPaths(removed).map(ownershipPattern);
  const markers = new Set([removed, 'database-choice']);
  return new Map(
    [...documents]
      .filter(([file]) => {
        const path = `backend/src/${file}`;
        return !owned.some((pattern) => pattern.test(path));
      })
      .map(([file, text]) => [file, stripRemovedMarkers(text, markers)]),
  );
}
// feature:database-choice:end
