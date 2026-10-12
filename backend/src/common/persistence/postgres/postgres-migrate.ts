import { Pool } from 'pg';
import {
  applyPostgresMigrations,
  DatabaseAheadError,
  MIGRATION_LOCK_WAIT_MS,
  MigrationLockError,
  MigrationStatus,
  readMigrationStatus,
} from './postgres-migrations';

export const MIGRATE_COMMAND = {
  UP: 'up',
  STATUS: 'status',
} as const;

export type MigrateCommand =
  (typeof MIGRATE_COMMAND)[keyof typeof MIGRATE_COMMAND];

export const MIGRATE_EXIT = {
  DONE: 0,
  /** The database is not at this build, or `up` could not bring it there. */
  DIFFERS: 1,
  USAGE: 2,
} as const;

export function migrateCommandOf(argument: unknown): MigrateCommand | null {
  return argument === MIGRATE_COMMAND.UP || argument === MIGRATE_COMMAND.STATUS
    ? argument
    : null;
}

function describeStatus(status: MigrationStatus): string[] {
  return [
    `Applied: ${status.applied.length}`,
    `Pending: ${status.pending.length === 0 ? 'none' : status.pending.join(', ')}`,
    `Not carried by this build: ${status.unknown.length === 0 ? 'none' : status.unknown.join(', ')}`,
  ];
}

/**
 * Applies what is pending. A database ahead of this build, or a lock another
 * run kept, is said in a line and answered with a non-zero exit: neither is a
 * crash, and a deploy script has to be able to test for both.
 */
async function applyPending(
  pool: Pool,
  say: (line: string) => void,
  lockWaitMs: number,
): Promise<number> {
  try {
    const applied = await applyPostgresMigrations(pool, lockWaitMs);
    say(
      applied.length === 0
        ? 'Nothing to apply. The database is up to date.'
        : `Applied: ${applied.join(', ')}`,
    );
    return MIGRATE_EXIT.DONE;
  } catch (error) {
    if (
      error instanceof DatabaseAheadError ||
      error instanceof MigrationLockError
    ) {
      say(error.message);
      return MIGRATE_EXIT.DIFFERS;
    }
    throw error;
  }
}

/**
 * What the operator command does on an open pool. `up` applies what is
 * pending, in order, and says which. `status` changes nothing and exits
 * non-zero when the database is not at this build's version, so a deploy
 * script can test it.
 */
export async function runMigrateCommand(
  command: MigrateCommand,
  pool: Pool,
  say: (line: string) => void,
  lockWaitMs: number = MIGRATION_LOCK_WAIT_MS,
): Promise<number> {
  if (command === MIGRATE_COMMAND.UP) {
    return applyPending(pool, say, lockWaitMs);
  }
  const status = await readMigrationStatus(pool);
  describeStatus(status).forEach(say);
  return status.pending.length === 0 && status.unknown.length === 0
    ? MIGRATE_EXIT.DONE
    : MIGRATE_EXIT.DIFFERS;
}
