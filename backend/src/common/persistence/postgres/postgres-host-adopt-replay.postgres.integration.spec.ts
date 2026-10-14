import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adoptHostMigrations } from './postgres-adopt-host';
import {
  applyPostgresMigrations,
  DatabaseAheadError,
} from './postgres-migrations';
import { MIGRATE_CASE_TIMEOUT_MS } from './postgres-migrate.harness-spec';
import {
  HOST_FILE,
  HOST_SQL,
  useHostMigrations,
  waitForMigrationLock,
} from './postgres-host-migrate.harness-spec';

const INSERT_ORDER = 'INSERT INTO host_orders VALUES (7)';

describe('adoption fencing competing core builds', () => {
  const { emptyDatabase, sources, command, recorded, hostRecords } =
    useHostMigrations();

  it.each([
    {
      name: 'interleaving A: a queued older build refuses the adoption fence instead of replaying SQL',
      older: true,
      errorName: 'DatabaseAheadError',
      message:
        'The database holds migrations this build does not carry: 0020_host_migrations.sql. Nothing was applied. Run the build that carries them.',
    },
    {
      name: 'interleaving B: a queued current build refuses adopted files before applying pending core SQL',
      older: false,
      errorName: 'AdoptedCoreMigrationError',
      message:
        'The pending core migrations 0042_orders.sql were adopted as host migrations. Remove them from the core folder before running up. Nothing was applied.',
    },
  ])(
    '$name',
    async ({ older, errorName, message }) => {
      const pool = await emptyDatabase();
      const source = sources({ [HOST_FILE]: INSERT_ORDER });
      await pool.query(HOST_SQL);
      await pool.query(INSERT_ORDER);
      await pool.query(
        'CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
      );
      await pool.query(
        "INSERT INTO schema_migrations (name) VALUES ('0042_orders.sql')",
      );
      const coreFiles: Record<string, string> = { [HOST_FILE]: INSERT_ORDER };
      if (!older) {
        coreFiles['0001_before_orders.sql'] =
          'CREATE TABLE core_pending (id integer)';
        coreFiles['0020_host_migrations.sql'] = readFileSync(
          join(source.core.directory, '0020_host_migrations.sql'),
          'utf8',
        );
      }
      const competitor = {
        core: { ...source.core, directory: sources(coreFiles).host.directory },
        host: sources().host,
      };
      const holder = await pool.connect();
      await holder.query('SELECT pg_advisory_lock($1)', [source.host.lockKey]);
      const adopting = adoptHostMigrations(
        pool,
        [HOST_FILE],
        undefined,
        source,
      ).then(
        (names) => names,
        (error: unknown) => error,
      );
      let competing: Promise<unknown> | undefined;
      try {
        // Adoption owns core before the competing up queues behind it.
        await waitForMigrationLock(pool, source.host.lockKey, false, 1);
        competing = applyPostgresMigrations(
          pool,
          undefined,
          undefined,
          competitor,
        ).then(
          (names) => names,
          (error: unknown) => error,
        );
        await waitForMigrationLock(pool, source.core.lockKey, false, 1);
      } finally {
        await holder.query('SELECT pg_advisory_unlock($1)', [
          source.host.lockKey,
        ]);
        holder.release();
        await Promise.allSettled([adopting, ...(competing ? [competing] : [])]);
      }
      expect(await adopting).toEqual(['0042_orders.sql']);
      const refusal = await competing;
      expect(refusal).toMatchObject({ name: errorName, message });
      if (older) {
        expect(refusal).toBeInstanceOf(DatabaseAheadError);
        expect(refusal).toMatchObject({
          unknown: ['0020_host_migrations.sql'],
        });
      }
      expect(await command('up', pool, competitor)).toEqual({
        exit: 1,
        said: [message],
      });
      expect(await recorded(pool)).toEqual(['0020_host_migrations.sql']);
      expect(await hostRecords(pool)).toEqual(['0042_orders.sql']);
      expect(
        (await pool.query<{ id: number }>('SELECT id FROM host_orders')).rows,
      ).toEqual([{ id: 7 }]);
      const pending = await pool.query<{ found: string | null }>(
        "SELECT to_regclass('core_pending')::text AS found",
      );
      expect(pending.rows).toEqual([{ found: null }]);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'rolls the adoption fence and new host ledger back when a record transfer fails',
    async () => {
      const pool = await emptyDatabase();
      const source = sources({ [HOST_FILE]: INSERT_ORDER });
      await pool.query(
        'CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
      );
      await pool.query(
        "INSERT INTO schema_migrations (name) VALUES ('0042_orders.sql')",
      );
      await pool.query(`
        CREATE FUNCTION refuse_adoption_delete() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'Adoption record transfer refused';
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER refuse_adoption_delete BEFORE DELETE ON schema_migrations
          FOR EACH ROW EXECUTE FUNCTION refuse_adoption_delete();
      `);
      await expect(
        adoptHostMigrations(pool, [HOST_FILE], undefined, source),
      ).rejects.toMatchObject({ code: 'P0001' });
      expect(await recorded(pool)).toEqual(['0042_orders.sql']);
      const ledger = await pool.query<{ found: string | null }>(
        "SELECT to_regclass('host_migrations')::text AS found",
      );
      expect(ledger.rows).toEqual([{ found: null }]);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );
});
