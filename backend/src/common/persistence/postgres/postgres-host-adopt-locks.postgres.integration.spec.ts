import { adoptHostMigrations } from './postgres-adopt-host';
import { MigrationLockError } from './postgres-migrations';
import { MIGRATE_CASE_TIMEOUT_MS } from './postgres-migrate.harness-spec';
import {
  HOST_FILE,
  HOST_SQL,
  useHostMigrations,
  waitForMigrationLock,
} from './postgres-host-migrate.harness-spec';

describe('host adoption lock order', () => {
  const { emptyDatabase, sources, command, hostRecords } = useHostMigrations();

  it(
    'case 19: adoption waits for an up holding core, then moves records under core followed by host',
    async () => {
      const pool = await emptyDatabase();
      await command('up', pool, sources());
      const source = sources({ [HOST_FILE]: HOST_SQL });
      await pool.query(
        "INSERT INTO schema_migrations (name) VALUES ('0042_orders.sql')",
      );
      const blocker = await pool.connect();
      await blocker.query('BEGIN');
      await blocker.query(
        'LOCK TABLE schema_migrations IN ACCESS EXCLUSIVE MODE',
      );
      const up = command('up', pool, source);
      let adopting: ReturnType<typeof command> | undefined;
      try {
        await waitForMigrationLock(pool, source.core.lockKey, true, 1);
        adopting = command('adopt-host', pool, source, [HOST_FILE]);
        await waitForMigrationLock(pool, source.core.lockKey, false, 1);
        // Adoption must not hold host while it waits for core.
        const host = await blocker.query<{ free: boolean }>(
          'SELECT pg_try_advisory_lock($1) AS free',
          [source.host.lockKey],
        );
        expect(host.rows).toEqual([{ free: true }]);
        await blocker.query('SELECT pg_advisory_unlock($1)', [
          source.host.lockKey,
        ]);
      } finally {
        await blocker.query('COMMIT');
        blocker.release();
        await up;
        if (adopting) await adopting;
      }
      expect((await up).exit).toBe(1);
      expect(await adopting).toEqual({
        exit: 0,
        said: ['Adopted host: 0042_orders.sql'],
      });
      expect(await hostRecords(pool)).toEqual(['0042_orders.sql']);
      expect((await command('up', pool, source)).exit).toBe(0);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'case 19: an exhausted wait while up holds core raises MigrationLockError and exits 1',
    async () => {
      const pool = await emptyDatabase();
      await command('up', pool, sources());
      const source = sources({ [HOST_FILE]: HOST_SQL });
      await pool.query(
        "INSERT INTO schema_migrations (name) VALUES ('0042_orders.sql')",
      );
      const blocker = await pool.connect();
      await blocker.query('BEGIN');
      await blocker.query(
        'LOCK TABLE schema_migrations IN ACCESS EXCLUSIVE MODE',
      );
      const up = command('up', pool, source);
      try {
        await waitForMigrationLock(pool, source.core.lockKey, true, 1);
        await expect(
          adoptHostMigrations(pool, [HOST_FILE], 300, source),
        ).rejects.toBeInstanceOf(MigrationLockError);
        expect(
          await command('adopt-host', pool, source, [HOST_FILE], 300),
        ).toEqual({
          exit: 1,
          said: [
            'Another session held the migration lock for 300 ms. Either another migration run is still going, or one was interrupted and its session is still connected. Nothing was applied. Wait for the other run, or end that session, and run this again.',
          ],
        });
      } finally {
        await blocker.query('COMMIT');
        blocker.release();
        await up;
      }
      expect(await hostRecords(pool)).toEqual([]);
      expect(
        (await command('adopt-host', pool, source, [HOST_FILE])).exit,
      ).toBe(0);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'releases core when the host lock wait fails',
    async () => {
      const pool = await emptyDatabase();
      await command('up', pool, sources());
      const source = sources({ [HOST_FILE]: HOST_SQL });
      await pool.query(
        "INSERT INTO schema_migrations (name) VALUES ('0042_orders.sql')",
      );
      const holder = await pool.connect();
      await holder.query('SELECT pg_advisory_lock($1)', [source.host.lockKey]);
      try {
        expect(
          (await command('adopt-host', pool, source, [HOST_FILE], 300)).exit,
        ).toBe(1);
        const core = await holder.query<{ free: boolean }>(
          'SELECT pg_try_advisory_lock($1) AS free',
          [source.core.lockKey],
        );
        expect(core.rows).toEqual([{ free: true }]);
        await holder.query('SELECT pg_advisory_unlock($1)', [
          source.core.lockKey,
        ]);
      } finally {
        await holder.query('SELECT pg_advisory_unlock($1)', [
          source.host.lockKey,
        ]);
        holder.release();
      }
      expect(await hostRecords(pool)).toEqual([]);
      expect(
        (await command('adopt-host', pool, source, [HOST_FILE])).exit,
      ).toBe(0);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );
});
