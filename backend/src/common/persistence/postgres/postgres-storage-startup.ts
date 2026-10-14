import { Pool } from 'pg';
import { StorageNotReadyError, StorageStartup } from '../storage-startup';
import { retryStorageStartup } from '../storage-startup-retry';
import { mapPostgresError } from './postgres-persistence-errors';
import { readPostgresMigrationStatuses } from './postgres-migrations';
import { POSTGRES_MIGRATION_SOURCES } from './postgres-migration-sources';
import { MigrationSources } from './types/postgres-migrations';

/** Checks both ledgers; only an operator applies migrations. */
export class PostgresStorageStartup extends StorageStartup {
  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    private readonly expected?: string[],
    private readonly sources: MigrationSources = POSTGRES_MIGRATION_SOURCES,
  ) {
    super();
  }

  async prepare(): Promise<void> {
    const statuses = await retryStorageStartup(async () => {
      try {
        return await readPostgresMigrationStatuses(
          this.pool,
          this.sources,
          this.expected,
        );
      } catch (error) {
        throw mapPostgresError(error);
      }
    });
    // Unknown records need repair or adoption before applying pending files.
    for (const { source, unknown } of statuses) {
      if (unknown.length > 0) {
        const host = statuses.find((status) => status.source.id === 'host');
        const carriedHost = new Set([
          ...(host?.applied ?? []),
          ...(host?.pending ?? []),
        ]);
        const adoptable =
          source.id === 'core'
            ? unknown.filter((name) => carriedHost.has(name))
            : [];
        const message =
          source.id === 'core'
            ? `The database holds migrations this build does not carry: ${unknown.join(', ')}. Start the build that carries them, or restore the database.`
            : `The database holds host migrations this build does not carry: ${unknown.join(', ')}. Start the build that carries them, or repair forward with a new host migration.`;
        const adoption =
          adoptable.length === 0
            ? ''
            : ` These names are in the host folder. Move their records with adopt-host ${adoptable.join(' ')} before starting again.`;
        throw new StorageNotReadyError(message + adoption);
      }
    }
    for (const { source, pending } of statuses) {
      if (pending.length > 0) {
        throw new StorageNotReadyError(
          source.id === 'core'
            ? `The database is behind this build. Apply these migrations in order, then start again: ${pending.join(', ')}`
            : `The database is behind this build's host migrations. Apply these host migrations in order, then start again: ${pending.join(', ')}`,
        );
      }
    }
  }
}
