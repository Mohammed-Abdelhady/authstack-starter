import { Kysely, PostgresDialect, PostgresPool, sql } from 'kysely';
import { Client, Pool, PoolClient } from 'pg';
import { commitCheckedPool } from '../../src/common/persistence/postgres/postgres-commit-tag';
import {
  openPostgresDatabase,
  PostgresTables,
} from '../../src/common/persistence/postgres/postgres-database';
import { applyPostgresMigrations } from '../../src/common/persistence/postgres/postgres-migrations';
import {
  PostgresTestServer,
  startPostgresTestServer,
} from './server/postgres-test-server';

/**
 * Ends every other session of this database that the filter selects, and waits
 * for the server to report each one gone. Ending a session rolls its
 * transaction back and frees its locks.
 */
const END_SESSIONS = `
  SELECT pg_terminate_backend(pid, $1)
    FROM pg_stat_activity
   WHERE pid <> pg_backend_pid()
     AND datname = current_database()`;
const WITH_OPEN_WORK = ' AND xact_start IS NOT NULL';
/** The server's own bound on waiting for one session to go. */
const SESSION_END_WAIT_MS = 30_000;

/**
 * Every table of the adapter. A reset empties all of them in one statement,
 * so a harness cannot leave behind a table that refers to one it emptied. A
 * table added to the map and not named here does not compile.
 */
const EVERY_TABLE: Record<keyof PostgresTables, true> = {
  address_claims: true,
  security_events: true,
  native_dpop_proof_ids: true,
  native_attempts: true,
  email_codes: true, // feature:email-code
  native_credentials: true,
  authorization_transactions: true,
  browser_proofs: true,
  sessions: true,
  user_application_grants: true,
  applications: true,
  role_pending_sweeps: true,
  roles: true,
  pending_magic_links: true, // feature:magic-link
  pending_password_resets: true,
  pending_registrations: true,
  mail_counters: true,
  passkey_challenges: true, // feature:passkeys
  passkeys: true, // feature:passkeys
  two_factor_challenges: true, // feature:totp
  user_recovery_codes: true, // feature:totp
  user_two_factor: true, // feature:totp
  user_linked_accounts: true,
  session_proofs: true,
  staff_idempotency_keys: true,
  invitations: true, // feature:invitations
  users: true,
};
const [FIRST_TABLE, ...OTHER_TABLES] = Object.keys(EVERY_TABLE);
/**
 * Deletes the rows of every table in one statement, which checks the foreign
 * keys once, after all of them are gone. Not TRUNCATE: that gives every table
 * and index a new file, 124 files a reset, and a reset then waits on the
 * file system whenever other suites are creating and removing their own data.
 */
const EMPTY_EVERY_TABLE = sql`WITH ${sql.join(
  OTHER_TABLES.map(
    (table, index) =>
      sql`${sql.ref(`emptied_${index}`)} AS (DELETE FROM ${sql.table(table)})`,
  ),
)} DELETE FROM ${sql.table(FIRST_TABLE)}`;

/** Empties every table of the adapter in one statement. */
export async function emptyEveryTable(
  database: Kysely<PostgresTables>,
): Promise<void> {
  await EMPTY_EVERY_TABLE.execute(database);
}

export interface TestConnection<
  Dialect extends PostgresDialect = PostgresDialect,
> {
  readonly server: PostgresTestServer;
  readonly dialect: Dialect;
  readonly pool: Pool;
  readonly database: Kysely<PostgresTables>;
  readonly appliedMigrations: string[];
  /**
   * Rolls back whatever an earlier case left open, so its locks cannot hold
   * the next case's reset. Call it first in every `reset`.
   */
  readonly rollBackOpenWork: () => Promise<void>;
  /** Rolls open work back, then empties every table. The reset of a harness. */
  readonly reset: () => Promise<void>;
  /**
   * Stops the server whatever state the cases left: open transactions are
   * rolled back, and a connection a case never handed back is not waited for.
   */
  readonly close: () => Promise<void>;
}

/** A server that is stopping ends each of its sessions with this state. */
const SESSION_ENDED_BY_THE_SERVER = '57P01';

/**
 * For the `error` event of a pool or client the server is about to stop under:
 * the session ending is expected there, and anything else is still a fault.
 */
export function ignoreSessionEnd(error: unknown): void {
  if (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === SESSION_ENDED_BY_THE_SERVER
  ) {
    return;
  }
  throw error instanceof Error ? error : new Error(String(error));
}

/** A harness on the adapter's own dialect. */
export function openTestConnection(): Promise<TestConnection> {
  return openTestConnectionOn(
    (pool) => new PostgresDialect({ pool: commitCheckedPool(pool) }),
  );
}

/**
 * The one way a PostgreSQL harness gets its server, pool and migrated
 * database, and the one way it lets them go. A boot that fails part way stops
 * the server it started.
 */
export async function openTestConnectionOn<Dialect extends PostgresDialect>(
  makeDialect: (pool: PostgresPool) => Dialect,
): Promise<TestConnection<Dialect>> {
  const server = await startPostgresTestServer();
  const pool = new Pool(server.connection);
  const open = new Set<PoolClient>();
  let whenNoneOpen: (() => void) | undefined;
  // An idle connection the server drops must not take the test process down.
  pool.on('error', () => undefined);
  pool.on('connect', (client) => {
    open.add(client);
    // Nor must one a case still holds when teardown ends its session.
    client.on('error', () => undefined);
    client.once('end', () => {
      open.delete(client);
      if (open.size === 0) whenNoneOpen?.();
    });
  });

  // Outside the pool, so it is still there when a case holds every pooled
  // connection, and so ending the others never ends this one.
  const admin = new Client(server.connection);
  admin.on('error', () => undefined);
  const endSessions = async (filter: string): Promise<void> => {
    await admin.query(END_SESSIONS + filter, [SESSION_END_WAIT_MS]);
  };

  const close = async (): Promise<void> => {
    try {
      await endSessions('');
      await admin.end();
      if (open.size > 0) {
        await new Promise<void>((resolve) => {
          whenNoneOpen = resolve;
        });
      }
      // Every socket is closed now. A connection that was never handed back
      // stays counted by the pool, and ending the pool would wait for it.
      if (pool.totalCount === 0) {
        await pool.end();
      }
    } finally {
      await server.stop();
    }
  };

  try {
    await admin.connect();
    const appliedMigrations = await applyPostgresMigrations(pool);
    const dialect = makeDialect(pool);
    const database = openPostgresDatabase(pool, dialect);
    const rollBackOpenWork = (): Promise<void> => endSessions(WITH_OPEN_WORK);
    return {
      server,
      dialect,
      pool,
      database,
      appliedMigrations,
      rollBackOpenWork,
      reset: async () => {
        await rollBackOpenWork();
        await EMPTY_EVERY_TABLE.execute(database);
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
