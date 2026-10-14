import { PoolClient } from 'pg';
import { SQLSTATE, sqlStateOf } from '../../utils/sql-state.util';
import { MigrationSource } from './types/postgres-migrations';

/** A longer wait means another run is stuck or its session is still connected. */
export const MIGRATION_LOCK_WAIT_MS = 120_000;

export class MigrationLockError extends Error {
  constructor(waitedMs: number, source: MigrationSource) {
    super(
      source.id === 'core'
        ? `Another session held the migration lock for ${waitedMs} ms. Either another migration run is still going, or one was interrupted and its session is still connected. Nothing was applied. Wait for the other run, or end that session, and run this again.`
        : `Another session held the host migration lock for ${waitedMs} ms. Either another migration run is still going, or one was interrupted and its session is still connected. Wait for the other run, or end that session, and run this again.`,
    );
    this.name = 'MigrationLockError';
  }
}

/** Session locks need a direct connection, not a pooler in transaction mode. */
export async function takeMigrationLock(
  client: PoolClient,
  waitMs: number,
  source: MigrationSource,
): Promise<void> {
  await client.query("SELECT set_config('lock_timeout', $1, false)", [
    String(Math.trunc(waitMs)),
  ]);
  try {
    await client.query('SELECT pg_advisory_lock($1)', [source.lockKey]);
  } catch (error) {
    if (sqlStateOf(error) === SQLSTATE.LOCK_NOT_AVAILABLE) {
      throw new MigrationLockError(waitMs, source);
    }
    throw error;
  } finally {
    await client.query('RESET lock_timeout').catch(() => undefined);
  }
}

/** Discard a session if unlocking fails, so the pool cannot retain its lock. */
export async function releaseMigrationLocks(
  client: PoolClient,
  sources: MigrationSource[],
): Promise<void> {
  let discard = false;
  for (const source of [...sources].reverse()) {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [source.lockKey]);
    } catch {
      discard = true;
    }
  }
  client.release(discard);
}
