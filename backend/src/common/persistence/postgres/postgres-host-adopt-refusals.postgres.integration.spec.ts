import {
  EVERY_MIGRATION,
  MIGRATE_CASE_TIMEOUT_MS,
} from './postgres-migrate.harness-spec';
import {
  HOST_FILE,
  HOST_SQL,
  useHostMigrations,
} from './postgres-host-migrate.harness-spec';

describe('host adoption refusals', () => {
  const { emptyDatabase, sources, command, recorded, hostRecords } =
    useHostMigrations();

  it.each([
    {
      testCase: 'case 9: a name absent from the host folder',
      names: ['0044_absent.sql'],
      recordedName: '0044_absent.sql',
      reason: '0044_absent.sql is not in the host folder',
    },
    {
      testCase: 'case 9: a name absent from the core ledger',
      names: ['0042_orders.sql'],
      recordedName: null,
      reason: '0042_orders.sql is not recorded in the core ledger',
    },
    {
      testCase: 'case 14: a name the core build carries',
      names: ['0005_accounts.sql'],
      recordedName: null,
      reason: '0005_accounts.sql belongs to the core build',
    },
    {
      testCase: 'case 15: good and bad names together',
      names: ['0042_orders.sql', '0044_absent.sql'],
      recordedName: '0042_orders.sql',
      reason: '0044_absent.sql is not in the host folder',
    },
    {
      testCase: 'a path instead of a migration filename',
      names: ['../0042_orders.sql'],
      recordedName: null,
      reason: '../0042_orders.sql is not in the host folder',
    },
    {
      testCase: 'a whitespace-only name',
      names: [' '],
      recordedName: null,
      reason: '  is not in the host folder',
    },
  ])(
    '$testCase moves nothing',
    async ({ names, recordedName, reason }) => {
      const pool = await emptyDatabase();
      await command('up', pool, sources());
      const source = sources({ [HOST_FILE]: HOST_SQL });
      if (recordedName)
        await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [
          recordedName,
        ]);
      expect(await command('adopt-host', pool, source, names)).toEqual({
        exit: 1,
        said: [`Cannot adopt host migrations: ${reason}. Nothing was moved.`],
      });
      expect(await recorded(pool)).toEqual(
        recordedName ? [...EVERY_MIGRATION, recordedName] : EVERY_MIGRATION,
      );
      expect(await hostRecords(pool)).toEqual([]);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'case 15: invalid batch leaves even a missing host ledger absent',
    async () => {
      const pool = await emptyDatabase();
      const source = sources({ [HOST_FILE]: HOST_SQL });
      await pool.query(
        'CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
      );
      await pool.query(
        "INSERT INTO schema_migrations (name) VALUES ('0042_orders.sql')",
      );
      expect(
        (
          await command('adopt-host', pool, source, [
            HOST_FILE,
            '0044_absent.sql',
          ])
        ).exit,
      ).toBe(1);
      expect(await recorded(pool)).toEqual(['0042_orders.sql']);
      const ledger = await pool.query<{ found: string | null }>(
        "SELECT to_regclass('host_migrations')::text AS found",
      );
      expect(ledger.rows[0].found).toBeNull();
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'case 16: no names is a usage error with exit 2 and creates no ledger',
    async () => {
      const pool = await emptyDatabase();
      expect(await command('adopt-host', pool, sources())).toEqual({
        exit: 2,
        said: ['Usage: postgres-migrate adopt-host <name...>'],
      });
      const ledgers = await pool.query<{
        core: string | null;
        host: string | null;
      }>(
        "SELECT to_regclass('schema_migrations')::text AS core, to_regclass('host_migrations')::text AS host",
      );
      expect(ledgers.rows).toEqual([{ core: null, host: null }]);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'case 18: a name in both ledgers refuses the entire batch',
    async () => {
      const pool = await emptyDatabase();
      await command('up', pool, sources());
      const source = sources({
        [HOST_FILE]: HOST_SQL,
        '0043_order_items.sql': 'INVALID SQL',
      });
      await pool.query(
        "INSERT INTO schema_migrations (name) VALUES ('0042_orders.sql'), ('0043_order_items.sql')",
      );
      await pool.query(
        "INSERT INTO host_migrations (name) VALUES ('0043_order_items.sql')",
      );
      expect(
        await command('adopt-host', pool, source, [
          HOST_FILE,
          '0043_order_items.sql',
        ]),
      ).toEqual({
        exit: 1,
        said: [
          'Cannot adopt host migrations: 0043_order_items.sql is in both ledgers; repair the inconsistent records first. Nothing was moved.',
        ],
      });
      expect(await recorded(pool)).toEqual([
        ...EVERY_MIGRATION,
        '0042_orders.sql',
        '0043_order_items.sql',
      ]);
      expect(await hostRecords(pool)).toEqual(['0043_order_items.sql']);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );
});
