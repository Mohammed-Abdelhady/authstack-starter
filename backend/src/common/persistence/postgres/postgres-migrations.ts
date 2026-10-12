import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { SQLSTATE, sqlStateOf } from '../../utils/sql-state.util';

const MIGRATIONS_DIRECTORY = join(__dirname, 'migrations');
const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;
const UNDEFINED_TABLE = '42P01';
/**
 * One key for this application's migrations. Two operators who run the
 * command at once take turns, and the second finds nothing left to apply.
 */
const MIGRATION_LOCK_KEY = 4_815_162_342;

/** The adapter's migrations, in the order they are applied. */
export function listPostgresMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIRECTORY)
    .filter((file) => MIGRATION_FILE.test(file))
    .sort();
}

export interface MigrationStatus {
  /** Carried by this build and recorded in the database. */
  applied: string[];
  /** Carried by this build and not applied yet, in order. */
  pending: string[];
  /** Recorded in the database and not carried by this build. */
  unknown: string[];
}

/** The recorded migrations. A database nothing was applied to has no record. */
async function recordedMigrations(
  pool: Pick<Pool, 'query'>,
): Promise<Set<string>> {
  try {
    const recorded = await pool.query<{ name: string }>(
      'SELECT name FROM schema_migrations',
    );
    return new Set(recorded.rows.map(({ name }) => name));
  } catch (error) {
    if (sqlStateOf(error) === UNDEFINED_TABLE) {
      return new Set();
    }
    throw error;
  }
}

/** Compares what this build carries with what the database recorded. Changes nothing. */
export async function readMigrationStatus(
  pool: Pick<Pool, 'query'>,
  expected: string[] = listPostgresMigrations(),
): Promise<MigrationStatus> {
  const recorded = await recordedMigrations(pool);
  const carried = new Set(expected);
  return {
    applied: expected.filter((name) => recorded.has(name)),
    pending: expected.filter((name) => !recorded.has(name)),
    unknown: [...recorded].filter((name) => !carried.has(name)).sort(),
  };
}

/**
 * How long the command waits for another run to finish. A run applies small
 * files in seconds, and 0012 on a large table in a few minutes at most, so a
 * wait this long means the other run is stuck or was never there.
 */
export const MIGRATION_LOCK_WAIT_MS = 120_000;

/** Another session held the migration lock for the whole wait. */
export class MigrationLockError extends Error {
  constructor(waitedMs: number) {
    super(
      `Another session held the migration lock for ${waitedMs} ms. Either another migration run is still going, or one was interrupted and its session is still connected. Nothing was applied. Wait for the other run, or end that session, and run this again.`,
    );
    this.name = 'MigrationLockError';
  }
}

/** The database recorded migrations this build does not carry. */
export class DatabaseAheadError extends Error {
  constructor(readonly unknown: string[]) {
    super(
      `The database holds migrations this build does not carry: ${unknown.join(', ')}. Nothing was applied. Run the build that carries them.`,
    );
    this.name = 'DatabaseAheadError';
  }
}

/**
 * Takes the migration lock for this session, waiting at most `waitMs`. The
 * lock belongs to the session, so the connection has to be a direct one: a
 * pooler in transaction mode hands each statement to another session.
 */
async function takeMigrationLock(
  client: PoolClient,
  waitMs: number,
): Promise<void> {
  await client.query("SELECT set_config('lock_timeout', $1, false)", [
    String(Math.trunc(waitMs)),
  ]);
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  } catch (error) {
    if (sqlStateOf(error) === SQLSTATE.LOCK_NOT_AVAILABLE) {
      throw new MigrationLockError(waitMs);
    }
    throw error;
  } finally {
    await client.query('RESET lock_timeout').catch(() => undefined);
  }
}

/**
 * Applies the adapter's plain SQL files in name order, each in its own
 * transaction, and records the ones applied. The files are part of the adapter
 * and are run as written. An operator runs this; the server never does.
 *
 * A database that is ahead of this build is refused with `DatabaseAheadError`
 * before anything is applied: two builds that each carry a different next
 * file must not both apply theirs.
 *
 * A file lower in number than ones already recorded is applied too. That is
 * how a project that gains a feature later gets that feature's file.
 */
export async function applyPostgresMigrations(
  pool: Pool,
  lockWaitMs: number = MIGRATION_LOCK_WAIT_MS,
  files: string[] = listPostgresMigrations(),
): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  let locked = false;
  try {
    await takeMigrationLock(client, lockWaitMs);
    locked = true;
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const known = await client.query<{ name: string }>(
      'SELECT name FROM schema_migrations',
    );
    const done = new Set(known.rows.map(({ name }) => name));
    const carried = new Set(files);
    const unknown = [...done].filter((name) => !carried.has(name)).sort();
    if (unknown.length > 0) {
      throw new DatabaseAheadError(unknown);
    }
    for (const file of files) {
      if (done.has(file)) continue;
      const statements = readFileSync(join(MIGRATIONS_DIRECTORY, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(statements);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [
          file,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      applied.push(file);
    }
    return applied;
  } finally {
    if (locked) {
      // Ending the session frees the lock too, if this statement cannot run.
      await client
        .query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
        .catch(() => undefined);
    }
    client.release();
  }
}
