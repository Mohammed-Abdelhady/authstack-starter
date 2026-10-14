import {
  EVERY_MIGRATION,
  MIGRATE_CASE_TIMEOUT_MS,
} from './postgres-migrate.harness-spec';
import {
  HOST_FILE,
  HOST_SQL,
  useHostMigrations,
} from './postgres-host-migrate.harness-spec';

describe('adopting host migration records', () => {
  const { emptyDatabase, sources, command, recorded, hostRecords, startup } =
    useHostMigrations();

  it(
    'case 7: refuses unadopted core records, then starts and replays none after adoption',
    async () => {
      const pool = await emptyDatabase();
      await command('up', pool, sources());
      const source = sources({ [HOST_FILE]: HOST_SQL });
      await pool.query(
        "UPDATE schema_migrations SET applied_at = '2020-01-01T00:00:00Z' WHERE name = '0020_host_migrations.sql'",
      );
      await pool.query(HOST_SQL);
      await pool.query('INSERT INTO host_orders VALUES (7)');
      await pool.query(
        "INSERT INTO schema_migrations (name, applied_at) VALUES ('0042_orders.sql', '2020-01-02T03:04:05Z')",
      );
      expect(await startup(pool, source)).toEqual({
        name: 'StorageNotReadyError',
        message:
          'The database holds migrations this build does not carry: 0042_orders.sql. Start the build that carries them, or restore the database. These names are in the host folder. Move their records with adopt-host 0042_orders.sql before starting again.',
      });
      expect(await command('adopt-host', pool, source, [HOST_FILE])).toEqual({
        exit: 0,
        said: ['Adopted host: 0042_orders.sql'],
      });
      expect(await recorded(pool)).toEqual(EVERY_MIGRATION);
      const fence = await pool.query<{ applied_at: Date }>(
        "SELECT applied_at FROM schema_migrations WHERE name = '0020_host_migrations.sql'",
      );
      expect(fence.rows).toEqual([
        { applied_at: new Date('2020-01-01T00:00:00Z') },
      ]);
      const adopted = await pool.query<{ name: string; applied_at: Date }>(
        'SELECT name, applied_at FROM host_migrations',
      );
      expect(adopted.rows).toEqual([
        {
          name: '0042_orders.sql',
          applied_at: new Date('2020-01-02T03:04:05Z'),
        },
      ]);
      expect(await startup(pool, source)).toBe('serves');
      expect(await command('up', pool, source)).toEqual({
        exit: 0,
        said: ['Nothing to apply. The database is up to date.'],
      });
      expect(
        (await pool.query<{ id: number }>('SELECT id FROM host_orders')).rows,
      ).toEqual([{ id: 7 }]);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'case 8: creates a missing host ledger, records 0020 as a fence, and a second adoption changes nothing',
    async () => {
      const pool = await emptyDatabase();
      const source = sources({
        [HOST_FILE]: 'SELECT * FROM adoption_must_never_execute_file_sql',
      });
      await pool.query(
        'CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
      );
      await pool.query(
        "INSERT INTO schema_migrations (name, applied_at) VALUES ('0042_orders.sql', '2020-01-02T03:04:05Z')",
      );
      expect(await command('adopt-host', pool, source, [HOST_FILE])).toEqual({
        exit: 0,
        said: ['Adopted host: 0042_orders.sql'],
      });
      expect(await recorded(pool)).toEqual(['0020_host_migrations.sql']);
      expect(await hostRecords(pool)).toEqual(['0042_orders.sql']);
      expect(await command('adopt-host', pool, source, [HOST_FILE])).toEqual({
        exit: 0,
        said: ['Nothing to adopt.'],
      });
      expect(await recorded(pool)).toEqual(['0020_host_migrations.sql']);
      const rows = await pool.query<{ name: string; applied_at: Date }>(
        'SELECT name, applied_at FROM host_migrations',
      );
      expect(rows.rows).toEqual([
        {
          name: '0042_orders.sql',
          applied_at: new Date('2020-01-02T03:04:05Z'),
        },
      ]);
      const columns = await pool.query<{
        name: string;
        type: string;
        nullable: string;
        default_value: string | null;
      }>(
        "SELECT column_name AS name, data_type AS type, is_nullable AS nullable, column_default AS default_value FROM information_schema.columns WHERE table_name = 'host_migrations' ORDER BY ordinal_position",
      );
      expect(columns.rows).toEqual([
        { name: 'name', type: 'text', nullable: 'NO', default_value: null },
        {
          name: 'applied_at',
          type: 'timestamp with time zone',
          nullable: 'NO',
          default_value: 'now()',
        },
      ]);
      await expect(
        pool.query(
          "INSERT INTO host_migrations (name) VALUES ('0042_orders.sql')",
        ),
      ).rejects.toMatchObject({ code: '23505' });
      expect((await command('up', pool, source)).exit).toBe(0);
      expect(await recorded(pool)).toEqual(EVERY_MIGRATION);
      expect(await startup(pool, source)).toBe('serves');
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'case 17: a host-only record is a no-op and duplicate explicit names move only once',
    async () => {
      const pool = await emptyDatabase();
      const source = sources({
        [HOST_FILE]: HOST_SQL,
        '0043_order_items.sql': 'INVALID SQL',
      });
      await command('up', pool, sources());
      await pool.query(
        "INSERT INTO host_migrations (name, applied_at) VALUES ('0042_orders.sql', '2020-01-02T03:04:05Z')",
      );
      await pool.query(
        "INSERT INTO schema_migrations (name, applied_at) VALUES ('0043_order_items.sql', '2020-01-03T03:04:05Z')",
      );
      expect(
        await command('adopt-host', pool, source, [
          HOST_FILE,
          '0043_order_items.sql',
          '0043_order_items.sql',
        ]),
      ).toEqual({ exit: 0, said: ['Adopted host: 0043_order_items.sql'] });
      expect(await recorded(pool)).toEqual(EVERY_MIGRATION);
      const rows = await pool.query<{ name: string; applied_at: Date }>(
        'SELECT name, applied_at FROM host_migrations ORDER BY name',
      );
      expect(rows.rows).toEqual([
        {
          name: '0042_orders.sql',
          applied_at: new Date('2020-01-02T03:04:05Z'),
        },
        {
          name: '0043_order_items.sql',
          applied_at: new Date('2020-01-03T03:04:05Z'),
        },
      ]);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'case 17: adoption with nothing to move runs no ledger DDL',
    async () => {
      const pool = await emptyDatabase();
      const source = sources({ [HOST_FILE]: HOST_SQL });
      await command('up', pool, source);
      // Even CREATE TABLE IF NOT EXISTS reaches ddl_command_start on a replay.
      await pool.query(`
        CREATE FUNCTION refuse_adoption_ddl() RETURNS event_trigger AS $$
        BEGIN
          RAISE EXCEPTION 'Unexpected adoption DDL';
        END;
        $$ LANGUAGE plpgsql;
        CREATE EVENT TRIGGER refuse_adoption_ddl ON ddl_command_start
          WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION refuse_adoption_ddl();
      `);
      expect(await command('adopt-host', pool, source, [HOST_FILE])).toEqual({
        exit: 0,
        said: ['Nothing to adopt.'],
      });
      expect(await recorded(pool)).toEqual(EVERY_MIGRATION);
      expect(await hostRecords(pool)).toEqual(['0042_orders.sql']);
      const transactions = await pool.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'",
      );
      expect(transactions.rows).toEqual([{ count: 0 }]);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'rolls the whole move back when a later ledger write fails',
    async () => {
      const pool = await emptyDatabase();
      const source = sources({
        [HOST_FILE]: HOST_SQL,
        '0043_order_items.sql': 'INVALID SQL',
      });
      await command('up', pool, sources());
      await pool.query(
        "INSERT INTO schema_migrations (name) VALUES ('0042_orders.sql'), ('0043_order_items.sql')",
      );
      await pool.query(
        "ALTER TABLE host_migrations ADD CONSTRAINT blocked_host_record CHECK (name <> '0043_order_items.sql')",
      );
      await expect(
        command('adopt-host', pool, source, [
          HOST_FILE,
          '0043_order_items.sql',
        ]),
      ).rejects.toMatchObject({ code: '23514' });
      expect(await recorded(pool)).toEqual([
        ...EVERY_MIGRATION,
        '0042_orders.sql',
        '0043_order_items.sql',
      ]);
      expect(await hostRecords(pool)).toEqual([]);
      // A failed transaction and both locks are released, so a repaired retry works.
      await pool.query(
        'ALTER TABLE host_migrations DROP CONSTRAINT blocked_host_record',
      );
      expect(
        await command('adopt-host', pool, source, [
          HOST_FILE,
          '0043_order_items.sql',
        ]),
      ).toEqual({
        exit: 0,
        said: ['Adopted host: 0042_orders.sql, 0043_order_items.sql'],
      });
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );
});
