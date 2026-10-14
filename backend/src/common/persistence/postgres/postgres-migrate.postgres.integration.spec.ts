import {
  MIGRATE_COMMAND,
  migrateCommandOf,
  runMigrateCommand,
} from './postgres-migrate';
import {
  EVERY_MIGRATION,
  MIGRATE_CASE_TIMEOUT_MS,
  useMigrateDatabases,
} from './postgres-migrate.harness-spec';

describe('the PostgreSQL migration command', () => {
  const { emptyDatabase, run, recorded, startUp } = useMigrateDatabases();

  it('reads up, status and adopt-host as commands', () => {
    expect(
      ['up', 'status', 'adopt-host', 'down', '', undefined, 'UP'].map(
        migrateCommandOf,
      ),
    ).toEqual([
      MIGRATE_COMMAND.UP,
      MIGRATE_COMMAND.STATUS,
      MIGRATE_COMMAND.ADOPT_HOST,
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
            'Host applied: 0',
            'Host pending: none',
            'Host not carried by this build: none',
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
            'Host applied: 0',
            'Host pending: none',
            'Host not carried by this build: none',
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
            'Host applied: 0',
            'Host pending: none',
            'Host not carried by this build: none',
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
