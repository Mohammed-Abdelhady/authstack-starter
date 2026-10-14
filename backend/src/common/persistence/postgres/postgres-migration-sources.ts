import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { failureText } from '../../utils/sql-state.util';
import {
  ListedMigrationSource,
  MigrationSource,
  MigrationSources,
} from './types/postgres-migrations';

export const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;
export const HOST_LEDGER_MIGRATION = '0020_host_migrations.sql';
export const CORE_MIGRATION_LOCK_KEY = 4_815_162_342;
export const HOST_MIGRATION_LOCK_KEY = 4_815_162_343;

export const POSTGRES_MIGRATION_SOURCES: MigrationSources = {
  core: {
    id: 'core',
    directory: join(__dirname, 'migrations'),
    ledger: 'schema_migrations',
    lockKey: CORE_MIGRATION_LOCK_KEY,
  },
  host: {
    id: 'host',
    directory: join(__dirname, '..', '..', '..', 'host', 'migrations'),
    ledger: 'host_migrations',
    lockKey: HOST_MIGRATION_LOCK_KEY,
  },
};

export class MigrationSourceError extends Error {
  constructor(readonly collisions: string[]) {
    super(
      `The host source carries names also carried by the core source: ${collisions.join(', ')}. Give host files distinct names before running migrations or starting the server.`,
    );
    this.name = 'MigrationSourceError';
  }
}

export class MigrationEntryError extends Error {
  constructor(source: MigrationSource, entry: string) {
    super(
      `The ${source.id} migration entry ${entry} is not a regular file. Migrations must be regular files.`,
    );
    this.name = 'MigrationEntryError';
  }
}

function filesIn(source: MigrationSource): string[] {
  try {
    return readdirSync(source.directory, { withFileTypes: true })
      .filter((entry) => MIGRATION_FILE.test(entry.name))
      .map((entry) => {
        if (!entry.isFile()) throw new MigrationEntryError(source, entry.name);
        return entry.name;
      })
      .sort();
  } catch (error) {
    // Nest copies SQL only, so a host with no files has no folder in dist.
    if (
      source.id === 'host' &&
      typeof error === 'object' &&
      error !== null &&
      failureText(error, 'code') === 'ENOENT'
    ) {
      return [];
    }
    throw error;
  }
}

/** Lists both folders before any database work, including collision checks. */
export function listPostgresMigrationSources(
  sources: MigrationSources = POSTGRES_MIGRATION_SOURCES,
): ListedMigrationSource[] {
  const core = filesIn(sources.core);
  const host = filesIn(sources.host);
  const collisions = host.filter((name) => core.includes(name));
  if (collisions.length > 0) throw new MigrationSourceError(collisions);
  return [
    { source: sources.core, files: core },
    { source: sources.host, files: host },
  ];
}
