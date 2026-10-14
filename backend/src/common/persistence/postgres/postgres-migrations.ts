import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { sqlStateOf } from '../../utils/sql-state.util';
import {
  MIGRATION_LOCK_WAIT_MS,
  releaseMigrationLocks,
  takeMigrationLock,
} from './postgres-migration-lock';
import {
  listPostgresMigrationSources,
  POSTGRES_MIGRATION_SOURCES,
} from './postgres-migration-sources';
import {
  ListedMigrationSource,
  MigrationSource,
  MigrationSources,
  MigrationStatus,
  SourceMigrationStatus,
} from './types/postgres-migrations';

export {
  MIGRATION_LOCK_WAIT_MS,
  MigrationLockError,
} from './postgres-migration-lock';
const UNDEFINED_TABLE = '42P01';

/** The core files, including the checks shared with host listing. */
export function listPostgresMigrations(): string[] {
  return listPostgresMigrationSources()[0].files;
}

/** A database nothing was applied to has no record. */
export async function recordedMigrations(
  pool: Pick<Pool, 'query'>,
  source: MigrationSource,
): Promise<Set<string>> {
  try {
    const recorded = await pool.query<{ name: string }>(
      `SELECT name FROM ${source.ledger}`,
    );
    return new Set(recorded.rows.map(({ name }) => name));
  } catch (error) {
    if (sqlStateOf(error) === UNDEFINED_TABLE) return new Set();
    throw error;
  }
}

/** Compares the build with one ledger. Changes nothing. */
export async function readMigrationStatus(
  pool: Pick<Pool, 'query'>,
  expected: string[] = listPostgresMigrations(),
  source: MigrationSource = POSTGRES_MIGRATION_SOURCES.core,
): Promise<MigrationStatus> {
  const recorded = await recordedMigrations(pool, source);
  const carried = new Set(expected);
  return {
    applied: expected.filter((name) => recorded.has(name)),
    pending: expected.filter((name) => !recorded.has(name)),
    unknown: [...recorded].filter((name) => !carried.has(name)).sort(),
  };
}

export async function readPostgresMigrationStatuses(
  pool: Pick<Pool, 'query'>,
  sources: MigrationSources = POSTGRES_MIGRATION_SOURCES,
  coreFiles?: string[],
): Promise<SourceMigrationStatus[]> {
  const listed = listPostgresMigrationSources(sources);
  const statuses: SourceMigrationStatus[] = [];
  for (const { source, files } of listed) {
    const expected = source.id === 'core' ? (coreFiles ?? files) : files;
    statuses.push({
      source,
      ...(await readMigrationStatus(pool, expected, source)),
    });
  }
  return statuses;
}

/** Refuses only the source whose database is ahead of its files. */
export class DatabaseAheadError extends Error {
  constructor(
    readonly unknown: string[],
    readonly source: MigrationSource,
    adoptable: string[] = [],
  ) {
    super(
      (source.id === 'core'
        ? `The database holds migrations this build does not carry: ${unknown.join(', ')}. Nothing was applied. Run the build that carries them.`
        : `The database holds host migrations this build does not carry: ${unknown.join(', ')}. Nothing was applied to the host migrations. Run the build that carries them.`) +
        (adoptable.length === 0
          ? ''
          : ` These names are in the host folder. Move their records with adopt-host ${adoptable.join(' ')} before running up.`),
    );
    this.name = 'DatabaseAheadError';
  }
}

export class HostMigrationError extends Error {
  constructor(file: string, cause: unknown) {
    super(
      `The host source migration ${file} failed: ${cause instanceof Error ? cause.message : String(cause)}. This file was rolled back; earlier files and core migrations remain applied.`,
      { cause },
    );
    this.name = 'HostMigrationError';
  }
}

export class AdoptedCoreMigrationError extends Error {
  constructor(readonly names: string[]) {
    super(
      `The pending core migrations ${names.join(', ')} were adopted as host migrations. Remove them from the core folder before running up. Nothing was applied.`,
    );
    this.name = 'AdoptedCoreMigrationError';
  }
}

async function applyFile(
  client: PoolClient,
  source: MigrationSource,
  file: string,
): Promise<void> {
  const statements = readFileSync(join(source.directory, file), 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(statements);
    await client.query(`INSERT INTO ${source.ledger} (name) VALUES ($1)`, [
      file,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (source.id === 'host') throw new HostMigrationError(file, error);
    throw error;
  }
}

async function applySource(
  pool: Pool,
  source: MigrationSource,
  files: string[],
  host: ListedMigrationSource,
  lockWaitMs: number,
): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  const locked: MigrationSource[] = [];
  try {
    await takeMigrationLock(client, lockWaitMs, source);
    locked.push(source);
    // The core command owns its bootstrap; 0020 owns the host ledger shape.
    if (source.id === 'core') {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           name text PRIMARY KEY,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
    }
    const status = await readMigrationStatus(client, files, source);
    if (status.unknown.length > 0) {
      throw new DatabaseAheadError(
        status.unknown,
        source,
        source.id === 'core'
          ? status.unknown.filter((name) => host.files.includes(name))
          : [],
      );
    }
    if (source.id === 'core') {
      // Adoption holds this lock too, so moved records cannot be replayed here.
      const hostRecords = await recordedMigrations(client, host.source);
      const adopted = status.pending.filter((name) => hostRecords.has(name));
      if (adopted.length > 0) throw new AdoptedCoreMigrationError(adopted);
    }
    for (const file of status.pending) {
      await applyFile(client, source, file);
      applied.push(file);
    }
    return applied;
  } finally {
    await releaseMigrationLocks(client, locked);
  }
}

/** Core first, releasing its lock before host; each file commits on its own. */
export async function applyPostgresMigrations(
  pool: Pool,
  lockWaitMs: number = MIGRATION_LOCK_WAIT_MS,
  files?: string[],
  sources: MigrationSources = POSTGRES_MIGRATION_SOURCES,
): Promise<string[]> {
  const listed = listPostgresMigrationSources(sources);
  const applied: string[] = [];
  for (const { source, files: carried } of listed) {
    applied.push(
      ...(await applySource(
        pool,
        source,
        source.id === 'core' ? (files ?? carried) : carried,
        listed[1],
        lockWaitMs,
      )),
    );
  }
  return applied;
}
