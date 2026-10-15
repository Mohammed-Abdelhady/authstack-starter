import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADDRESS_BACKFILL_ZERO_COUNTS,
  EVERY_MIGRATION,
  MIGRATE_CASE_TIMEOUT_MS,
} from './postgres-migrate.harness-spec';
import {
  HOST_FILE,
  HOST_SQL,
  useHostMigrations,
  waitForMigrationLock,
} from './postgres-host-migrate.harness-spec';

describe('applying host migrations', () => {
  const { emptyDatabase, sources, command, recorded, hostRecords, startup } =
    useHostMigrations();

  it(
    'forwards a host migration notice through the command output',
    async () => {
      const pool = await emptyDatabase();
      const source = sources({
        [HOST_FILE]: `${HOST_SQL};
          DO $$ BEGIN RAISE NOTICE 'Host migration completed'; END $$;`,
      });

      expect(await command('up', pool, source)).toEqual({
        exit: 0,
        said: [
          ADDRESS_BACKFILL_ZERO_COUNTS,
          'Host migration completed',
          `Applied: ${EVERY_MIGRATION.join(', ')}, 0042_orders.sql`,
        ],
      });
      expect(await hostRecords(pool)).toEqual(['0042_orders.sql']);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'case 4: two concurrent up runs take turns and the second applies nothing',
    async () => {
      const pool = await emptyDatabase();
      const source = sources({
        [HOST_FILE]: HOST_SQL,
        '0043_order_items.sql':
          'CREATE TABLE host_order_items (order_id integer REFERENCES host_orders)',
      });
      const holder = await pool.connect();
      await holder.query('SELECT pg_advisory_lock($1)', [source.host.lockKey]);
      const runs = [command('up', pool, source)];
      let results: Awaited<ReturnType<typeof command>>[] = [];
      try {
        // The first finished core and is queued for host before the second starts.
        await waitForMigrationLock(pool, source.host.lockKey, false, 1);
        runs.push(command('up', pool, source));
        await waitForMigrationLock(pool, source.host.lockKey, false, 2);
      } finally {
        await holder.query('SELECT pg_advisory_unlock($1)', [
          source.host.lockKey,
        ]);
        holder.release();
        results = await Promise.all(runs);
      }
      expect(results).toEqual([
        {
          exit: 0,
          said: [
            ADDRESS_BACKFILL_ZERO_COUNTS,
            `Applied: ${EVERY_MIGRATION.join(', ')}, 0042_orders.sql, 0043_order_items.sql`,
          ],
        },
        { exit: 0, said: ['Nothing to apply. The database is up to date.'] },
      ]);
      expect(await recorded(pool)).toEqual(EVERY_MIGRATION);
      expect(await hostRecords(pool)).toEqual([
        '0042_orders.sql',
        '0043_order_items.sql',
      ]);
      const tables = await pool.query<{ orders: string; items: string }>(
        "SELECT to_regclass('host_orders')::text AS orders, to_regclass('host_order_items')::text AS items",
      );
      expect(tables.rows).toEqual([
        { orders: 'host_orders', items: 'host_order_items' },
      ]);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'case 5: a failed host file rolls back alone and repair replays only that file',
    async () => {
      const pool = await emptyDatabase();
      const source = sources({
        [HOST_FILE]: HOST_SQL,
        '0043_bad.sql':
          'CREATE TABLE host_partial (id integer); SELECT * FROM host_missing_relation;',
      });
      const failed = await command('up', pool, source);
      expect(failed.exit).toBe(1);
      expect(failed.said).toEqual([
        ADDRESS_BACKFILL_ZERO_COUNTS,
        'The host source migration 0043_bad.sql failed: relation "host_missing_relation" does not exist. This file was rolled back; earlier files and core migrations remain applied.',
      ]);
      expect(await recorded(pool)).toEqual(EVERY_MIGRATION);
      expect(await hostRecords(pool)).toEqual(['0042_orders.sql']);
      const tables = await pool.query<{
        good: string | null;
        partial: string | null;
      }>(
        "SELECT to_regclass('host_orders')::text AS good, to_regclass('host_partial')::text AS partial",
      );
      expect(tables.rows).toEqual([{ good: 'host_orders', partial: null }]);
      writeFileSync(
        join(source.host.directory, '0043_bad.sql'),
        'CREATE TABLE host_partial (id integer)',
      );
      expect(await command('up', pool, source)).toEqual({
        exit: 0,
        said: ['Applied: 0043_bad.sql'],
      });
      expect(await hostRecords(pool)).toEqual([
        '0042_orders.sql',
        '0043_bad.sql',
      ]);
      expect(await startup(pool, source)).toBe('serves');
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'case 20: unadopted host records refuse core up before any pending SQL and point to adopt-host',
    async () => {
      const pool = await emptyDatabase();
      const source = sources({ [HOST_FILE]: HOST_SQL });
      await pool.query(
        'CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
      );
      await pool.query(
        "INSERT INTO schema_migrations (name) VALUES ('0042_orders.sql')",
      );
      expect(await command('up', pool, source)).toEqual({
        exit: 1,
        said: [
          'The database holds migrations this build does not carry: 0042_orders.sql. Nothing was applied. Run the build that carries them. These names are in the host folder. Move their records with adopt-host 0042_orders.sql before running up.',
        ],
      });
      expect(await recorded(pool)).toEqual(['0042_orders.sql']);
      const tables = await pool.query<{
        core: string | null;
        host: string | null;
        orders: string | null;
      }>(
        "SELECT to_regclass('users')::text AS core, to_regclass('host_migrations')::text AS host, to_regclass('host_orders')::text AS orders",
      );
      expect(tables.rows).toEqual([{ core: null, host: null, orders: null }]);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );
});
