import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { MigrateCommand, runMigrateCommand } from './postgres-migrate';
import { useMigrateDatabases } from './postgres-migrate.harness-spec';
import { POSTGRES_MIGRATION_SOURCES } from './postgres-migration-sources';
import { MIGRATION_LOCK_WAIT_MS } from './postgres-migrations';
import { PostgresStorageStartup } from './postgres-storage-startup';
import { MigrationSources } from './types/postgres-migrations';

export const HOST_FILE = '0042_orders.sql';
export const HOST_SQL = 'CREATE TABLE host_orders (id integer PRIMARY KEY)';
export const HOST_STATUS_EMPTY = [
  'Host applied: 0',
  'Host pending: none',
  'Host not carried by this build: none',
];

/** Reuses the migrate databases; each case owns and removes its host folder. */
export function useHostMigrations() {
  const databases = useMigrateDatabases();
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0))
      rmSync(folder, { recursive: true, force: true });
  });

  return {
    ...databases,
    sources: (files: Record<string, string> = {}): MigrationSources => {
      const directory = mkdtempSync(join(tmpdir(), 'host-migrations-'));
      folders.push(directory);
      for (const [name, sql] of Object.entries(files)) {
        writeFileSync(join(directory, name), sql);
      }
      return {
        core: POSTGRES_MIGRATION_SOURCES.core,
        host: { ...POSTGRES_MIGRATION_SOURCES.host, directory },
      };
    },
    command: async (
      command: MigrateCommand,
      pool: Pool,
      sources: MigrationSources,
      names: string[] = [],
      waitMs = MIGRATION_LOCK_WAIT_MS,
    ) => {
      const said: string[] = [];
      const exit = await runMigrateCommand(
        command,
        pool,
        (line) => said.push(line),
        waitMs,
        { sources, names },
      );
      return { exit, said };
    },
    hostRecords: async (pool: Pool): Promise<string[]> => {
      const rows = await pool.query<{ name: string }>(
        'SELECT name FROM host_migrations ORDER BY name',
      );
      return rows.rows.map(({ name }) => name);
    },
    startup: (pool: Pool, sources: MigrationSources) =>
      new PostgresStorageStartup(pool, undefined, sources).prepare().then(
        () => 'serves',
        (error: Error) => ({ name: error.name, message: error.message }),
      ),
  };
}

/** Observe lock waits rather than sleeping and hoping the command started. */
export async function waitForMigrationLock(
  pool: Pool,
  lockKey: number,
  granted: boolean,
  count: number,
): Promise<void> {
  const deadline = AbortSignal.timeout(5_000);
  while (!deadline.aborted) {
    const result = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM pg_locks
       WHERE locktype = 'advisory' AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
         AND classid::bigint = $1 AND objid::bigint = $2 AND granted = $3`,
      [Math.trunc(lockKey / 4_294_967_296), lockKey % 4_294_967_296, granted],
    );
    if (result.rows[0].count === count) return;
  }
  throw new Error(`Did not observe ${count} migration lock holders or waiters`);
}
