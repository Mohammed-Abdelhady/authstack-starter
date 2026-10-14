import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import {
  MIGRATION_LOCK_WAIT_MS,
  releaseMigrationLocks,
  takeMigrationLock,
} from './postgres-migration-lock';
import {
  HOST_LEDGER_MIGRATION,
  listPostgresMigrationSources,
  POSTGRES_MIGRATION_SOURCES,
} from './postgres-migration-sources';
import { recordedMigrations } from './postgres-migrations';
import { MigrationSource, MigrationSources } from './types/postgres-migrations';

export class HostAdoptionError extends Error {
  constructor(reason: string) {
    super(`Cannot adopt host migrations: ${reason}. Nothing was moved.`);
    this.name = 'HostAdoptionError';
  }
}

function namesToMove(
  names: string[],
  coreFiles: string[],
  hostFiles: string[],
  core: Set<string>,
  host: Set<string>,
): string[] {
  const moving: string[] = [];
  for (const name of new Set(names)) {
    if (coreFiles.includes(name)) {
      throw new HostAdoptionError(`${name} belongs to the core build`);
    }
    if (!hostFiles.includes(name)) {
      throw new HostAdoptionError(`${name} is not in the host folder`);
    }
    if (core.has(name) && host.has(name)) {
      throw new HostAdoptionError(
        `${name} is in both ledgers; repair the inconsistent records first`,
      );
    }
    if (host.has(name)) continue;
    if (!core.has(name)) {
      throw new HostAdoptionError(`${name} is not recorded in the core ledger`);
    }
    moving.push(name);
  }
  return moving;
}

/** Moves explicit records, preserving their dates and never replaying file SQL. */
export async function adoptHostMigrations(
  pool: Pool,
  names: string[],
  lockWaitMs: number = MIGRATION_LOCK_WAIT_MS,
  sources: MigrationSources = POSTGRES_MIGRATION_SOURCES,
): Promise<string[]> {
  if (names.length === 0)
    throw new HostAdoptionError('supply at least one name');
  const listed = listPostgresMigrationSources(sources);
  const client = await pool.connect();
  const locked: MigrationSource[] = [];
  try {
    for (const { source } of listed) {
      await takeMigrationLock(client, lockWaitMs, source);
      locked.push(source);
    }
    // Read before BEGIN: an absent legacy ledger must not abort the transaction.
    const core = await recordedMigrations(client, sources.core);
    const host = await recordedMigrations(client, sources.host);
    const moving = namesToMove(
      names,
      listed[0].files,
      listed[1].files,
      core,
      host,
    );
    // A replay must not run ledger DDL or open a transaction when nothing moves.
    if (moving.length === 0) return [];
    const ledgerSql = readFileSync(
      join(sources.core.directory, HOST_LEDGER_MIGRATION),
      'utf8',
    );
    await client.query('BEGIN');
    try {
      await client.query(ledgerSql);
      // Older builds must refuse after these records leave the core ledger.
      await client.query(
        `INSERT INTO ${sources.core.ledger} (name) VALUES ($1)
         ON CONFLICT (name) DO NOTHING`,
        [HOST_LEDGER_MIGRATION],
      );
      for (const name of moving) {
        await client.query(
          `INSERT INTO ${sources.host.ledger} (name, applied_at)
           SELECT name, applied_at FROM ${sources.core.ledger} WHERE name = $1`,
          [name],
        );
        await client.query(
          `DELETE FROM ${sources.core.ledger} WHERE name = $1`,
          [name],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    return moving;
  } finally {
    await releaseMigrationLocks(client, locked);
  }
}
