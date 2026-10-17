import { sql } from 'kysely';
import { AddressLedgerHarness } from '../utils/address-ledger-contract/address-ledger-harness';
import { FrozenClock, TEST_NOW } from '../utils/frozen-clock';
import { ADDRESS_CLAIM_KIND } from '../../src/common/persistence/address-ledger';
import { RetryableAbortError } from '../../src/common/persistence/persistence-errors';
import { PostgresAddressLedger } from '../../src/common/persistence/postgres/postgres-address-ledger';
import {
  PostgresUnitOfWorkRunner,
  postgresTransactionOf,
} from '../../src/common/persistence/postgres/postgres-unit-of-work';
import { openTestConnection } from './postgres-connection';

export async function bootPostgresAddressLedgerHarness(): Promise<AddressLedgerHarness> {
  const connection = await openTestConnection();
  const { database } = connection;
  return {
    ledger: new PostgresAddressLedger(),
    clock: new FrozenClock(TEST_NOW),
    runner: (pause) => new PostgresUnitOfWorkRunner(database, pause),
    retryableAbort: () => new RetryableAbortError(),
    claims: async () => {
      const rows = await database
        .selectFrom('address_claims')
        .selectAll()
        .orderBy('address')
        .execute();
      return rows.map((row) => {
        const kind = Object.values(ADDRESS_CLAIM_KIND).find(
          (value) => value === row.kind,
        );
        if (!kind) throw new Error('unexpected stored claim kind');
        return {
          address: row.address,
          kind,
          owner: row.owner,
          lapsesAt: row.lapses_at,
        };
      });
    },
    accounts: async () => {
      const rows = await database
        .selectFrom('users')
        .select(['email', 'is_deleted'])
        .orderBy('email')
        .execute();
      return rows.map((row) => ({
        email: row.email,
        deleted: row.is_deleted,
      }));
    },
    seedClaim: async (input) => {
      await database
        .insertInto('address_claims')
        .values({
          address: input.address,
          kind: input.kind,
          owner: input.owner,
          lapses_at: input.lapsesAt,
        })
        .execute();
    },
    seedAccount: async (email, deleted = false) => {
      const row = await database
        .insertInto('users')
        .values({
          email,
          is_deleted: deleted,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },
    insertAccount: async (uow, email) => {
      const row = await postgresTransactionOf(uow)
        .insertInto('users')
        .values({ email })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },
    contention: () => {
      let stopped = false;
      return {
        stop: () => {
          stopped = true;
        },
        runner: new PostgresUnitOfWorkRunner(database),
        blocked: async () => {
          // Observe the database lock, rather than assuming a query has arrived.
          while (!stopped) {
            const waiting = await sql<{ blocked: boolean }>`
            SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity
               WHERE datname = current_database()
                 AND pid <> pg_backend_pid()
                 AND wait_event_type = 'Lock'
                 AND query LIKE '%"address_claims"%'
                 AND cardinality(pg_blocking_pids(pid)) > 0
            ) AS blocked
          `.execute(database);
            if (waiting.rows[0]?.blocked) return;
          }
          throw new Error('contention observation stopped');
        },
      };
    },
    reset: connection.reset,
    close: connection.close,
  };
}
