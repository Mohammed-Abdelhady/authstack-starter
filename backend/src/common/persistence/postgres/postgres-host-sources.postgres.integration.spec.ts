import { rmSync } from 'node:fs';
import { applyPostgresMigrations } from './postgres-migrations';
import {
  EVERY_MIGRATION,
  MIGRATE_CASE_TIMEOUT_MS,
} from './postgres-migrate.harness-spec';
import {
  HOST_FILE,
  HOST_SQL,
  HOST_STATUS_EMPTY,
  useHostMigrations,
} from './postgres-host-migrate.harness-spec';

const HOST_STATUS_APPLIED = [
  'Host applied: 1',
  'Host pending: none',
  'Host not carried by this build: none',
];

describe('host migration sources', () => {
  const { emptyDatabase, sources, command, recorded, hostRecords, startup } =
    useHostMigrations();

  it(
    'case 1 and 22: starts with both sources applied and keeps the core status lines first',
    async () => {
      const pool = await emptyDatabase();
      const source = sources({ [HOST_FILE]: HOST_SQL });
      expect(await command('up', pool, source)).toEqual({
        exit: 0,
        said: [`Applied: ${EVERY_MIGRATION.join(', ')}, 0042_orders.sql`],
      });
      expect(await recorded(pool)).toEqual(EVERY_MIGRATION);
      expect(await hostRecords(pool)).toEqual(['0042_orders.sql']);
      expect(await startup(pool, source)).toBe('serves');
      expect(await command('status', pool, source)).toEqual({
        exit: 0,
        said: [
          `Applied: ${EVERY_MIGRATION.length}`,
          'Pending: none',
          'Not carried by this build: none',
          ...HOST_STATUS_APPLIED,
        ],
      });
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'case 2: a missing applied host file stops startup and refuses host up',
    async () => {
      const pool = await emptyDatabase();
      await command('up', pool, sources({ [HOST_FILE]: HOST_SQL }));
      const older = sources();
      expect(await startup(pool, older)).toEqual({
        name: 'StorageNotReadyError',
        message:
          'The database holds host migrations this build does not carry: 0042_orders.sql. Start the build that carries them, or repair forward with a new host migration.',
      });
      expect(await command('up', pool, older)).toEqual({
        exit: 1,
        said: [
          'The database holds host migrations this build does not carry: 0042_orders.sql. Nothing was applied to the host migrations. Run the build that carries them.',
        ],
      });
      expect(await command('status', pool, older)).toEqual({
        exit: 1,
        said: [
          `Applied: ${EVERY_MIGRATION.length}`,
          'Pending: none',
          'Not carried by this build: none',
          'Host applied: 0',
          'Host pending: none',
          'Host not carried by this build: 0042_orders.sql',
        ],
      });
      expect(await hostRecords(pool)).toEqual(['0042_orders.sql']);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'case 6: up gives a database from before this plan its host ledger',
    async () => {
      const pool = await emptyDatabase();
      const source = sources();
      await applyPostgresMigrations(
        pool,
        undefined,
        EVERY_MIGRATION.filter((name) => name !== '0020_host_migrations.sql'),
        source,
      );
      const before = await pool.query<{ found: string | null }>(
        "SELECT to_regclass('host_migrations')::text AS found",
      );
      expect(before.rows[0].found).toBeNull();
      expect(await startup(pool, source)).toEqual({
        name: 'StorageNotReadyError',
        message:
          'The database is behind this build. Apply these migrations in order, then start again: 0020_host_migrations.sql',
      });
      expect(await command('up', pool, source)).toEqual({
        exit: 0,
        said: ['Applied: 0020_host_migrations.sql'],
      });
      expect(await hostRecords(pool)).toEqual([]);
      expect(await recorded(pool)).toEqual(EVERY_MIGRATION);
      expect(await startup(pool, source)).toBe('serves');
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it.each([10, 11])(
    'case %i: missing and non-SQL-only host folders are empty',
    async (caseNumber) => {
      const pool = await emptyDatabase();
      const source = sources({
        'README.md': 'Host files belong here',
        'bad.sql': 'INVALID SQL',
        '0001_UPPER.sql': 'INVALID SQL',
      });
      if (caseNumber === 10) rmSync(source.host.directory, { recursive: true });
      expect((await command('up', pool, source)).exit).toBe(0);
      expect(await hostRecords(pool)).toEqual([]);
      expect(await startup(pool, source)).toBe('serves');
      expect(await command('status', pool, source)).toEqual({
        exit: 0,
        said: [
          `Applied: ${EVERY_MIGRATION.length}`,
          'Pending: none',
          'Not carried by this build: none',
          ...HOST_STATUS_EMPTY,
        ],
      });
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'case 12: pending host files refuse startup as behind and status exits non-zero',
    async () => {
      const pool = await emptyDatabase();
      await command('up', pool, sources());
      const source = sources({ [HOST_FILE]: HOST_SQL });
      expect(await startup(pool, source)).toEqual({
        name: 'StorageNotReadyError',
        message:
          "The database is behind this build's host migrations. Apply these host migrations in order, then start again: 0042_orders.sql",
      });
      expect(await command('status', pool, source)).toEqual({
        exit: 1,
        said: [
          `Applied: ${EVERY_MIGRATION.length}`,
          'Pending: none',
          'Not carried by this build: none',
          'Host applied: 0',
          'Host pending: 0042_orders.sql',
          'Host not carried by this build: none',
        ],
      });
      expect(await hostRecords(pool)).toEqual([]);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'case 13: up, status and startup refuse colliding filenames before any SQL runs',
    async () => {
      const pool = await emptyDatabase();
      const source = sources({
        '0005_accounts.sql': 'CREATE TABLE host_collision (id integer)',
      });
      const message =
        'The host source carries names also carried by the core source: 0005_accounts.sql. Give host files distinct names before running migrations or starting the server.';
      expect(await command('up', pool, source)).toEqual({
        exit: 1,
        said: [message],
      });
      expect(await command('status', pool, source)).toEqual({
        exit: 1,
        said: [message],
      });
      expect(await startup(pool, source)).toEqual({
        name: 'MigrationSourceError',
        message,
      });
      const tables = await pool.query<{
        core: string | null;
        host: string | null;
        collision: string | null;
      }>(
        "SELECT to_regclass('schema_migrations')::text AS core, to_regclass('host_migrations')::text AS host, to_regclass('host_collision')::text AS collision",
      );
      expect(tables.rows).toEqual([
        { core: null, host: null, collision: null },
      ]);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );
});
