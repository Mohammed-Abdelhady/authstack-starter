import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { ignoreSessionEnd } from '../../../../test/postgres/postgres-connection';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
  PostgresTestServer,
  startPostgresTestServer,
} from '../../../../test/postgres/server/postgres-test-server';
import { runMigrateCommand } from './postgres-migrate';
import { PostgresStorageStartup } from './postgres-storage-startup';

/**
 * Budget for a case that runs the migration command against a database of its
 * own: it creates the database and applies every migration while other
 * suites start servers. Slowest measured: 27 seconds.
 */
export const MIGRATE_CASE_TIMEOUT_MS = 60_000;

export const EVERY_MIGRATION = [
  '0001_browser_issuance.sql',
  '0002_roles.sql',
  '0003_pending_codes.sql',
  '0004_browser_proofs_security_events.sql',
  '0005_accounts.sql',
  '0006_session_authority_revocation.sql',
  '0007_applications_grants.sql',
  '0008_two_factor.sql', // feature:totp
  '0009_passkeys.sql', // feature:passkeys
  '0010_native_sign_in.sql',
  '0011_session_listing.sql',
  '0012_retention_indexes.sql',
  '0013_magic_links.sql', // feature:magic-link
  '0014_code_guess_locks.sql',
  '0017_two_factor_lockout.sql', // feature:totp
];

export interface MigrateDatabases {
  /** A database nothing was ever applied to. */
  emptyDatabase: () => Promise<Pool>;
  run: (
    command: 'up' | 'status',
    pool: Pool,
  ) => Promise<{ exit: number; said: string[] }>;
  /** The migration names the database recorded, in name order. */
  recorded: (pool: Pool) => Promise<string[]>;
  /** What a server starting on this database answers. */
  startUp: (pool: Pool, carried?: string[]) => Promise<string>;
}

/** One server for the calling suite, and a database of its own for each case. */
export function useMigrateDatabases(): MigrateDatabases {
  let server: PostgresTestServer;
  let admin: Pool;
  const pools: Pool[] = [];

  beforeAll(async () => {
    server = await startPostgresTestServer();
    admin = new Pool(server.connection);
  }, POSTGRES_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    // A pool reports its connections as closed before their sockets are, so
    // the server stopping below can still end one. That is not a failure.
    for (const pool of pools) pool.on('error', ignoreSessionEnd);
    admin?.on('error', ignoreSessionEnd);
    await Promise.all(pools.map((pool) => pool.end()));
    await admin?.end();
    await server?.stop();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  return {
    emptyDatabase: async () => {
      const name = `migrate_${randomUUID().replaceAll('-', '')}`;
      await admin.query(`CREATE DATABASE "${name}"`);
      const pool = new Pool({ ...server.connection, database: name });
      pools.push(pool);
      return pool;
    },
    run: async (command, pool) => {
      const said: string[] = [];
      const exit = await runMigrateCommand(command, pool, (line) =>
        said.push(line),
      );
      return { exit, said };
    },
    recorded: async (pool) => {
      const rows = await pool.query<{ name: string }>(
        'SELECT name FROM schema_migrations ORDER BY name',
      );
      return rows.rows.map(({ name }) => name);
    },
    startUp: (pool, carried) =>
      new PostgresStorageStartup(pool, carried).prepare().then(
        () => 'serves',
        (error: Error) => error.name,
      ),
  };
}
