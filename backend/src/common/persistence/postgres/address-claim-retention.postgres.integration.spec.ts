import { sql } from 'kysely';
import {
  openTestConnection,
  TestConnection,
} from '../../../../test/postgres/postgres-connection';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/postgres/server/postgres-test-server';
import { invitationRetentionCases } from '../../../../test/utils/address-retention/invitation-retention-cases'; // feature:invitations
// feature:invitations:start
import { PostgresInvitationStore } from '../../../../src/auth/invitations/persistence/postgres/postgres-invitation.store';
import { InvitationIssuer } from '../../../../src/auth/invitations/services/invitation-issuer';
// feature:invitations:end
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import { RaceGate } from '../../../../test/utils/race-gate';
import { ADDRESS_CLAIM_KIND } from '../address-ledger';
import { PostgresAddressLedger } from './postgres-address-ledger';
import { applyPostgresMigrations } from './postgres-migrations';
import { removeExpiredRows } from './postgres-retention';
import {
  PostgresUnitOfWorkRunner,
  postgresTransactionOf,
} from './postgres-unit-of-work';

const NOW = new Date('2031-05-06T07:08:09.000Z');
const ADDRESS = 'held@example.test';
const RULE = [
  { table: 'address_claims' as const, column: 'lapses_at', keepForMs: 0 },
];

describe('PostgreSQL address-claim physical retention', () => {
  let connection: TestConnection;
  let runner: PostgresUnitOfWorkRunner;
  const ledger = new PostgresAddressLedger();
  const clock = new FrozenClock(NOW);
  beforeAll(async () => {
    connection = await openTestConnection();
    runner = new PostgresUnitOfWorkRunner(connection.database);
  }, POSTGRES_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await connection?.close();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    await connection.reset();
    clock.set(NOW);
  }, POSTGRES_RESET_TIMEOUT_MS);

  async function claim(owner: string, lapsesAt: Date) {
    return runner.run((work) =>
      ledger.claim(work, {
        address: ADDRESS,
        kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
        owner,
        lapsesAt,
        now: NOW,
      }),
    );
  }
  async function claims() {
    return connection.database
      .selectFrom('address_claims')
      .selectAll()
      .orderBy('address')
      .execute();
  }
  async function awaitBlockedCleanup(signal: AbortSignal) {
    while (!signal.aborted) {
      const blocked = await sql<{ waiting: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query LIKE '%DELETE FROM "address_claims"%'
            AND cardinality(pg_blocking_pids(pid)) > 0
        ) AS waiting
      `.execute(connection.database);
      if (blocked.rows[0]?.waiting) return;
    }
    throw new Error('Cleanup observation stopped');
  }

  it('prunes only lapsed claims through the registry and leaves live account addresses protected', async () => {
    await connection.database
      .insertInto('address_claims')
      .values([
        {
          address: 'expired@example.test',
          owner: 'orphan',
          kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
          lapses_at: new Date(NOW.getTime() - 1),
        },
        {
          address: 'deadline@example.test',
          owner: 'orphan',
          kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
          lapses_at: NOW,
        },
        {
          address: 'live@example.test',
          owner: 'live',
          kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
          lapses_at: new Date(NOW.getTime() + 1),
        },
      ])
      .execute();
    await connection.database
      .insertInto('users')
      .values({ email: 'expired@example.test' })
      .execute();
    const pass = await removeExpiredRows(connection.database, NOW, {
      batchRows: 1,
      batchesPerRun: 1,
    });
    expect(pass.removed.address_claims).toBe(1);
    expect((await claims()).length).toBe(2);
    expect(
      (await removeExpiredRows(connection.database, NOW)).removed
        .address_claims,
    ).toBe(1);
    expect((await claims()).map((row) => row.address)).toEqual([
      'live@example.test',
    ]);
    expect(
      await runner.run((work) =>
        ledger.isFree(work, { address: 'expired@example.test', now: NOW }),
      ),
    ).toBe(false);
    await expect(
      sql`INSERT INTO address_claims (address, kind, owner, lapses_at) VALUES ('null@example.test', 'EMAIL_CHANGE', 'legacy', NULL)`.execute(
        connection.database,
      ),
    ).rejects.toMatchObject({ code: '23502' });
  });

  it('adds the expiry index on an existing migrated table without changing its live rows', async () => {
    await claim('existing', TEST_NOW);
    await connection.pool.query('DROP INDEX address_claims_lapses_at');
    await connection.pool.query(
      "DELETE FROM schema_migrations WHERE name = '0034_address_claim_retention.sql'",
    );
    expect(await applyPostgresMigrations(connection.pool)).toEqual([
      '0034_address_claim_retention.sql',
    ]);
    const indexes = await connection.pool.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'address_claims_lapses_at'",
    );
    expect(indexes.rows.map((row) => row.indexdef)).toEqual([
      'CREATE INDEX address_claims_lapses_at ON public.address_claims USING btree (lapses_at)',
    ]);
    expect(
      (await claims()).map((row) => ({
        owner: row.owner,
        expires: row.lapses_at,
      })),
    ).toEqual([{ owner: 'existing', expires: TEST_NOW }]);
  });

  // feature:invitations:start
  invitationRetentionCases(() => ({
    issuer: new InvitationIssuer(
      new PostgresInvitationStore(connection.database),
      ledger,
      clock,
    ),
    ledger,
    runner,
    clock,
    cleanup: async () => {
      await removeExpiredRows(connection.database, clock.now());
    },
    owners: async () => (await claims()).map((row) => row.owner),
  }));
  // feature:invitations:end

  it.each(['same-owner', 'replacement-owner'])(
    'keeps a committed live %s update when cleanup had selected the old expired version',
    async (owner) => {
      await claim('same-owner', NOW);
      const held = new RaceGate();
      const renewal = runner.run(async (work) => {
        expect(
          await ledger.claim(work, {
            address: ADDRESS,
            owner,
            kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
            lapsesAt: TEST_NOW,
            now: NOW,
          }),
        ).toBe('claimed');
        await held.hold();
      });
      let cleanup: ReturnType<typeof removeExpiredRows> | undefined;
      let observer: Promise<void> | undefined;
      const observation = new AbortController();
      try {
        await held.reached();
        cleanup = removeExpiredRows(
          connection.database,
          NOW,
          { batchRows: 1, batchesPerRun: 1 },
          RULE,
        );
        observer = awaitBlockedCleanup(observation.signal);
        await Promise.race([
          observer,
          cleanup.then(() => {
            throw new Error('Cleanup did not wait for the held row');
          }),
        ]);
        held.release();
        await renewal;
        expect((await cleanup).removed.address_claims).toBe(0);
        await runner.run((work) =>
          ledger.release(work, { address: ADDRESS, owner: 'obsolete-owner' }),
        );
        expect(
          (await claims()).map((row) => ({
            owner: row.owner,
            expires: row.lapses_at,
          })),
        ).toEqual([{ owner, expires: TEST_NOW }]);
      } finally {
        held.release();
        observation.abort();
        await Promise.allSettled([renewal, cleanup, observer]);
      }
    },
  );

  it('leaves an uncommitted account reservation to its creator and preserves the resulting account', async () => {
    const held = new RaceGate();
    const creator = runner.run(async (work) => {
      const result = await ledger.reserveForAccount(work, {
        address: ADDRESS,
        now: NOW,
      });
      if (result.status !== 'reserved') throw new Error('Reservation refused');
      await held.hold();
      await postgresTransactionOf(work)
        .insertInto('users')
        .values({ email: ADDRESS })
        .execute();
      await ledger.finishAccountReservation(work, result.reservation);
    });
    try {
      await held.reached();
      expect(
        (await removeExpiredRows(connection.database, NOW)).removed
          .address_claims,
      ).toBe(0);
      expect(await claims()).toEqual([]);
      held.release();
      await creator;
      expect(await claims()).toEqual([]);
      expect(
        await runner.run((work) =>
          ledger.isFree(work, { address: ADDRESS, now: NOW }),
        ),
      ).toBe(false);
      expect(
        await connection.database.selectFrom('users').select('email').execute(),
      ).toEqual([{ email: ADDRESS }]);
    } finally {
      held.release();
      await creator;
    }
  });
});
