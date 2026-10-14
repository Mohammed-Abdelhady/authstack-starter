import {
  EVERY_MIGRATION,
  MIGRATE_CASE_TIMEOUT_MS,
} from './postgres-migrate.harness-spec';
import { applyPostgresMigrations } from './postgres-migrations';
import {
  HOST_FILE,
  HOST_SQL,
  useHostMigrations,
} from './postgres-host-migrate.harness-spec';

describe('startup reports unknown migrations before pending files', () => {
  const { emptyDatabase, sources, command, startup, recorded } =
    useHostMigrations();

  it(
    'a pre-plan database reports the legacy host record and adoption hint before pending 0020',
    async () => {
      const pool = await emptyDatabase();
      await applyPostgresMigrations(
        pool,
        undefined,
        EVERY_MIGRATION.filter((name) => name !== '0020_host_migrations.sql'),
        sources(),
      );
      await pool.query(
        "INSERT INTO schema_migrations (name) VALUES ('0042_orders.sql')",
      );
      const source = sources({ [HOST_FILE]: HOST_SQL });
      expect(await startup(pool, source)).toEqual({
        name: 'StorageNotReadyError',
        message:
          'The database holds migrations this build does not carry: 0042_orders.sql. Start the build that carries them, or restore the database. These names are in the host folder. Move their records with adopt-host 0042_orders.sql before starting again.',
      });
      expect(await recorded(pool)).toEqual([
        ...EVERY_MIGRATION.filter(
          (name) => name !== '0020_host_migrations.sql',
        ),
        '0042_orders.sql',
      ]);
      const ledger = await pool.query<{ found: string | null }>(
        "SELECT to_regclass('host_migrations')::text AS found",
      );
      expect(ledger.rows).toEqual([{ found: null }]);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'unknown host records take priority over pending core files',
    async () => {
      const pool = await emptyDatabase();
      const source = sources();
      await command('up', pool, source);
      await pool.query(
        "DELETE FROM schema_migrations WHERE name = '0020_host_migrations.sql'",
      );
      await pool.query(
        "INSERT INTO host_migrations (name) VALUES ('9999_newer_host.sql')",
      );
      expect(await startup(pool, source)).toEqual({
        name: 'StorageNotReadyError',
        message:
          'The database holds host migrations this build does not carry: 9999_newer_host.sql. Start the build that carries them, or repair forward with a new host migration.',
      });
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );
});
