import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { StorageStartupHarness } from '../utils/startup/storage-startup-contract';
import { listPostgresMigrations } from '../../src/common/persistence/postgres/postgres-migrations';
import { PostgresStorageStartup } from '../../src/common/persistence/postgres/postgres-storage-startup';
import { ignoreSessionEnd, openTestConnection } from './postgres-connection';
import { startPostgresTestServer } from './server/postgres-test-server';

const UNIQUE_VIOLATION = '23505';
const TWO_HOURS_MS = 7_200_000;

/** A migration this build would carry and the database was never given. */
const NOT_APPLIED = '9999_not_applied_yet.sql';
/** A migration the database was given, taken out of what the build carries. */
const APPLIED_AND_NOT_CARRIED = '0002_roles.sql';

/**
 * Runs the start-up check against a server nothing was ever applied to, and
 * says what it answered and whether a migration record exists afterwards.
 */
export async function prepareOnEmptyDatabase(
  carried: string[],
): Promise<{ refused: string; record: string | null }> {
  const server = await startPostgresTestServer();
  const pool = new Pool(server.connection);
  // The pool reports a connection closed before its socket is, so the server
  // stopping below can still end one.
  pool.on('error', ignoreSessionEnd);
  try {
    const refused = await new PostgresStorageStartup(pool, carried)
      .prepare()
      .then(
        () => 'prepared',
        (error: Error) => error.message,
      );
    const record = await pool.query<{ found: string | null }>(
      "SELECT to_regclass('schema_migrations')::text AS found",
    );
    return { refused, record: record.rows[0]?.found ?? null };
  } finally {
    await pool.end();
    await server.stop();
  }
}

export async function bootPostgresStartupHarness(): Promise<StorageStartupHarness> {
  const connection = await openTestConnection();
  const { database, pool } = connection;
  const carried = listPostgresMigrations();

  return {
    startup: new PostgresStorageStartup(pool),
    refusesDuplicateCredential: async () => {
      const now = new Date('2099-01-01T12:00:00.000Z');
      const user = await database
        .insertInto('users')
        .values({ is_deleted: false })
        .returning('id')
        .executeTakeFirstOrThrow();
      const tokenHash = Buffer.from(randomUUID());
      const store = () =>
        database
          .insertInto('sessions')
          .values({
            user_id: user.id,
            token_hash: tokenHash,
            user_agent: 'Contract/1',
            device: null,
            ip: '127.0.0.1',
            client_id: 'web',
            user_version: 0,
            client_version: 0,
            grant_version: 0,
            auth_epoch: 1,
            schema_version: 1,
            scopes: ['api'],
            audience: 'api',
            authentication_methods: [],
            credential_purpose: 'browser_session',
            browser_generation: 1,
            authenticated_at: now,
            last_used_at: now,
            last_activity_at: now,
            expires_at: new Date(now.getTime() + TWO_HOURS_MS),
            idle_expires_at: new Date(now.getTime() + TWO_HOURS_MS),
          })
          .execute();
      await store();
      try {
        await store();
      } catch (error) {
        return (
          typeof error === 'object' &&
          error !== null &&
          Reflect.get(error, 'code') === UNIQUE_VIOLATION
        );
      }
      return false;
    },
    // A migration owns the rule, and this adapter never changes the store.
    loseCredentialRule: () => Promise.resolve(false),
    behindThisBuild: () =>
      new PostgresStorageStartup(pool, [...carried, NOT_APPLIED]),
    aheadOfThisBuild: () =>
      new PostgresStorageStartup(
        pool,
        carried.filter((name) => name !== APPLIED_AND_NOT_CARRIED),
      ),
    migrationRecord: async () => {
      const applied = await pool.query<{ name: string }>(
        'SELECT name FROM schema_migrations ORDER BY name',
      );
      return applied.rows.map(({ name }) => name);
    },
    close: connection.close,
  };
}
