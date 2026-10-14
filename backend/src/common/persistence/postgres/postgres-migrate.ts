import { Pool } from 'pg';
import { adoptHostMigrations, HostAdoptionError } from './postgres-adopt-host';
import {
  AdoptedCoreMigrationError,
  applyPostgresMigrations,
  DatabaseAheadError,
  HostMigrationError,
  MIGRATION_LOCK_WAIT_MS,
  MigrationLockError,
  readPostgresMigrationStatuses,
} from './postgres-migrations';
import {
  MigrationEntryError,
  MigrationSourceError,
} from './postgres-migration-sources';
import { MigrateOptions, MigrationStatus } from './types/postgres-migrations';

export const MIGRATE_COMMAND = {
  UP: 'up',
  STATUS: 'status',
  ADOPT_HOST: 'adopt-host',
} as const;

export type MigrateCommand =
  (typeof MIGRATE_COMMAND)[keyof typeof MIGRATE_COMMAND];

export const MIGRATE_EXIT = {
  DONE: 0,
  /** The database is not at this build, or the command could not bring it there. */
  DIFFERS: 1,
  USAGE: 2,
} as const;

export function migrateCommandOf(argument: unknown): MigrateCommand | null {
  return argument === MIGRATE_COMMAND.UP ||
    argument === MIGRATE_COMMAND.STATUS ||
    argument === MIGRATE_COMMAND.ADOPT_HOST
    ? argument
    : null;
}

function describeStatus(status: MigrationStatus, host: boolean): string[] {
  return [
    `${host ? 'Host applied' : 'Applied'}: ${status.applied.length}`,
    `${host ? 'Host pending' : 'Pending'}: ${status.pending.length === 0 ? 'none' : status.pending.join(', ')}`,
    `${host ? 'Host not carried by this build' : 'Not carried by this build'}: ${status.unknown.length === 0 ? 'none' : status.unknown.join(', ')}`,
  ];
}

/** Operator refusals exit non-zero; unexpected core SQL faults still propagate. */
export async function runMigrateCommand(
  command: MigrateCommand,
  pool: Pool,
  say: (line: string) => void,
  lockWaitMs: number = MIGRATION_LOCK_WAIT_MS,
  options: MigrateOptions = {},
): Promise<number> {
  if (command === MIGRATE_COMMAND.ADOPT_HOST && !options.names?.length) {
    say('Usage: postgres-migrate adopt-host <name...>');
    return MIGRATE_EXIT.USAGE;
  }
  try {
    if (command === MIGRATE_COMMAND.UP) {
      const applied = await applyPostgresMigrations(
        pool,
        lockWaitMs,
        undefined,
        options.sources,
      );
      say(
        applied.length === 0
          ? 'Nothing to apply. The database is up to date.'
          : `Applied: ${applied.join(', ')}`,
      );
      return MIGRATE_EXIT.DONE;
    }
    if (command === MIGRATE_COMMAND.ADOPT_HOST) {
      const moved = await adoptHostMigrations(
        pool,
        options.names ?? [],
        lockWaitMs,
        options.sources,
      );
      say(
        moved.length === 0
          ? 'Nothing to adopt.'
          : `Adopted host: ${moved.join(', ')}`,
      );
      return MIGRATE_EXIT.DONE;
    }
    const statuses = await readPostgresMigrationStatuses(pool, options.sources);
    for (const status of statuses) {
      describeStatus(status, status.source.id === 'host').forEach(say);
    }
    return statuses.every(
      ({ pending, unknown }) => pending.length === 0 && unknown.length === 0,
    )
      ? MIGRATE_EXIT.DONE
      : MIGRATE_EXIT.DIFFERS;
  } catch (error) {
    if (
      error instanceof DatabaseAheadError ||
      error instanceof AdoptedCoreMigrationError ||
      error instanceof MigrationLockError ||
      error instanceof HostMigrationError ||
      error instanceof HostAdoptionError ||
      error instanceof MigrationEntryError ||
      error instanceof MigrationSourceError
    ) {
      say(error.message);
      return MIGRATE_EXIT.DIFFERS;
    }
    throw error;
  }
}
