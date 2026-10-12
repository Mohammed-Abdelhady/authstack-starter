import { Pool } from 'pg';
import { StorageNotReadyError, StorageStartup } from '../storage-startup';
import { retryStorageStartup } from '../storage-startup-retry';
import { mapPostgresError } from './postgres-persistence-errors';
import {
  listPostgresMigrations,
  readMigrationStatus,
} from './postgres-migrations';

/**
 * Checks and never changes anything: the unique rules and indexes are part of
 * the migrations, and a migration is applied by an operator, not by a server
 * that is starting. A database that is behind this build, or ahead of it, is
 * refused with the names of the migrations that differ.
 */
export class PostgresStorageStartup extends StorageStartup {
  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    private readonly expected: string[] = listPostgresMigrations(),
  ) {
    super();
  }

  async prepare(): Promise<void> {
    const { pending, unknown } = await retryStorageStartup(async () => {
      try {
        return await readMigrationStatus(this.pool, this.expected);
      } catch (error) {
        throw mapPostgresError(error);
      }
    });
    if (pending.length > 0) {
      throw new StorageNotReadyError(
        `The database is behind this build. Apply these migrations in order, then start again: ${pending.join(', ')}`,
      );
    }
    if (unknown.length > 0) {
      throw new StorageNotReadyError(
        `The database holds migrations this build does not carry: ${unknown.join(', ')}. Start the build that carries them, or restore the database.`,
      );
    }
  }
}
