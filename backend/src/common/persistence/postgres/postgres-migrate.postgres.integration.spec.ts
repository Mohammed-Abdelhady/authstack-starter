import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
  PostgresTestServer,
  startPostgresTestServer,
} from '../../../../test/postgres/server/postgres-test-server';
import {
  MIGRATE_COMMAND,
  migrateCommandOf,
  runMigrateCommand,
} from './postgres-migrate';
import { PostgresStorageStartup } from './postgres-storage-startup';

/** Budget for a case that applies every migration to a database of its own. */
const MIGRATE_CASE_TIMEOUT_MS = 60_000;

const EVERY_MIGRATION = [
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
];
/** What is left to apply once the first four files are in. */
const AFTER_THE_FOURTH = EVERY_MIGRATION.slice(4);

describe('the PostgreSQL migration command', () => {
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
    for (const pool of pools) pool.on('error', () => undefined);
    admin?.on('error', () => undefined);
    await Promise.all(pools.map((pool) => pool.end()));
    await admin?.end();
    await server?.stop();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  /** A database nothing was ever applied to. */
  async function emptyDatabase(): Promise<Pool> {
    const name = `migrate_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    const pool = new Pool({ ...server.connection, database: name });
    pools.push(pool);
    return pool;
  }

  async function run(
    command: 'up' | 'status',
    pool: Pool,
  ): Promise<{ exit: number; said: string[] }> {
    const said: string[] = [];
    const exit = await runMigrateCommand(command, pool, (line) =>
      said.push(line),
    );
    return { exit, said };
  }

  async function recorded(pool: Pool): Promise<string[]> {
    const rows = await pool.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name',
    );
    return rows.rows.map(({ name }) => name);
  }

  const startUp = (pool: Pool): Promise<string> =>
    new PostgresStorageStartup(pool).prepare().then(
      () => 'serves',
      (error: Error) => error.name,
    );

  it('reads only up and status as commands', () => {
    expect(
      ['up', 'status', 'down', '', undefined, 'UP'].map(migrateCommandOf),
    ).toEqual([
      MIGRATE_COMMAND.UP,
      MIGRATE_COMMAND.STATUS,
      null,
      null,
      null,
      null,
    ]);
  });

  it(
    'reports a database behind the build without changing it, and exits non-zero',
    async () => {
      const pool = await emptyDatabase();

      const status = await run('status', pool);
      const record = await pool.query<{ found: string | null }>(
        "SELECT to_regclass('schema_migrations')::text AS found",
      );

      expect({ status, record: record.rows[0].found }).toEqual({
        status: {
          exit: 1,
          said: [
            'Applied: 0',
            `Pending: ${EVERY_MIGRATION.join(', ')}`,
            'Not carried by this build: none',
          ],
        },
        record: null,
      });
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'applies what is pending once, and a server that refused to start then serves',
    async () => {
      const pool = await emptyDatabase();

      const before = await startUp(pool);
      const first = await run('up', pool);
      const second = await run('up', pool);
      const status = await run('status', pool);

      expect({
        before,
        first,
        second,
        status,
        recorded: await recorded(pool),
        after: await startUp(pool),
      }).toEqual({
        before: 'StorageNotReadyError',
        first: { exit: 0, said: [`Applied: ${EVERY_MIGRATION.join(', ')}`] },
        second: {
          exit: 0,
          said: ['Nothing to apply. The database is up to date.'],
        },
        status: {
          exit: 0,
          said: [
            `Applied: ${EVERY_MIGRATION.length}`,
            'Pending: none',
            'Not carried by this build: none',
          ],
        },
        recorded: EVERY_MIGRATION,
        after: 'serves',
      });
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'lets two operators run it at once: each migration is applied by one of them',
    async () => {
      const pool = await emptyDatabase();

      const [one, other] = await Promise.all([
        run('up', pool),
        run('up', pool),
      ]);
      const said = [...one.said, ...other.said].sort();

      expect({
        exits: [one.exit, other.exit],
        said,
        recorded: await recorded(pool),
      }).toEqual({
        exits: [0, 0],
        said: [
          `Applied: ${EVERY_MIGRATION.join(', ')}`,
          'Nothing to apply. The database is up to date.',
        ],
        recorded: EVERY_MIGRATION,
      });
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'names a migration the database holds and this build does not carry, and refuses to apply on top of it',
    async () => {
      const pool = await emptyDatabase();
      await run('up', pool);
      await pool.query(
        "INSERT INTO schema_migrations (name) VALUES ('9999_from_a_newer_build.sql')",
      );

      expect({
        status: await run('status', pool),
        up: await run('up', pool),
      }).toEqual({
        status: {
          exit: 1,
          said: [
            `Applied: ${EVERY_MIGRATION.length}`,
            'Pending: none',
            'Not carried by this build: 9999_from_a_newer_build.sql',
          ],
        },
        up: {
          exit: 1,
          said: [
            'The database holds migrations this build does not carry: 9999_from_a_newer_build.sql. Nothing was applied. Run the build that carries them.',
          ],
        },
      });
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'applies nothing to a database that is ahead and behind at once',
    async () => {
      const pool = await emptyDatabase();
      await pool.query(
        'CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
      );
      await pool.query(
        "INSERT INTO schema_migrations (name) VALUES ('9999_from_a_newer_build.sql')",
      );

      const up = await run('up', pool);

      expect({ exit: up.exit, recorded: await recorded(pool) }).toEqual({
        exit: 1,
        recorded: ['9999_from_a_newer_build.sql'],
      });
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'leaves nothing of a migration that failed part way, and applies only what is missing afterwards',
    async () => {
      const pool = await emptyDatabase();
      // 0005 adds the password column first and creates this table later.
      await pool.query('CREATE TABLE user_linked_accounts (blocker integer)');

      const failure = await run('up', pool).then(
        () => 'applied',
        (error: { code?: string }) => error.code,
      );
      const passwordColumn = await pool.query(
        "SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_hash'",
      );
      const status = await run('status', pool);
      const recordedAfterFailure = await recorded(pool);
      const refused = await startUp(pool);
      await pool.query('DROP TABLE user_linked_accounts');

      expect({
        failure,
        passwordColumns: passwordColumn.rowCount,
        status,
        recordedAfterFailure,
        refused,
        again: await run('up', pool),
        recorded: await recorded(pool),
        after: await startUp(pool),
      }).toEqual({
        failure: '42P07',
        passwordColumns: 0,
        status: {
          exit: 1,
          said: [
            'Applied: 4',
            `Pending: ${AFTER_THE_FOURTH.join(', ')}`,
            'Not carried by this build: none',
          ],
        },
        recordedAfterFailure: [
          '0001_browser_issuance.sql',
          '0002_roles.sql',
          '0003_pending_codes.sql',
          '0004_browser_proofs_security_events.sql',
        ],
        refused: 'StorageNotReadyError',
        again: {
          exit: 0,
          said: [`Applied: ${AFTER_THE_FOURTH.join(', ')}`],
        },
        recorded: EVERY_MIGRATION,
        after: 'serves',
      });
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'gives up after its wait when another session keeps the migration lock, and applies nothing',
    async () => {
      const pool = await emptyDatabase();
      const holder = await pool.connect();
      await holder.query('SELECT pg_advisory_lock(4815162342)');
      const said: string[] = [];

      // The wait is the server's own lock timeout, 300 ms here, not a sleep.
      const exit = await runMigrateCommand(
        'up',
        pool,
        (line) => said.push(line),
        300,
      );
      await holder.query('SELECT pg_advisory_unlock(4815162342)');
      holder.release();
      const record = await pool.query<{ found: string | null }>(
        "SELECT to_regclass('schema_migrations')::text AS found",
      );

      expect({
        exit,
        said,
        record: record.rows[0].found,
        after: await run('up', pool),
      }).toEqual({
        exit: 1,
        said: [
          'Another session held the migration lock for 300 ms. Either another migration run is still going, or one was interrupted and its session is still connected. Nothing was applied. Wait for the other run, or end that session, and run this again.',
        ],
        record: null,
        after: { exit: 0, said: [`Applied: ${EVERY_MIGRATION.join(', ')}`] },
      });
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );
});
