import { sql } from 'kysely';
import { PostgresInvitationStore } from '../../src/auth/invitations/persistence/postgres/postgres-invitation.store';
import { PostgresAddressLedger } from '../../src/common/persistence/postgres/postgres-address-ledger';
import { PostgresUnitOfWorkRunner } from '../../src/common/persistence/postgres/postgres-unit-of-work';
import { FrozenClock, TEST_NOW } from '../utils/frozen-clock';
import type { InvitationHarness } from '../utils/invitation-contract/invitation-harness';
import { openTestConnection } from './postgres-connection';

export async function bootPostgresInvitationHarness(): Promise<InvitationHarness> {
  const connection = await openTestConnection();
  const { database } = connection;
  return {
    store: new PostgresInvitationStore(database),
    ledger: new PostgresAddressLedger(),
    clock: new FrozenClock(TEST_NOW),
    runner: (pause) => new PostgresUnitOfWorkRunner(database, pause),
    seedAccount: async (email) => {
      const user = await database
        .insertInto('users')
        .values({ email })
        .returning('id')
        .executeTakeFirstOrThrow();
      return user.id;
    },
    contention: () => {
      let stopped = false;
      return {
        runner: new PostgresUnitOfWorkRunner(database),
        stop: () => {
          stopped = true;
        },
        blocked: async () => {
          while (!stopped) {
            const result = await sql<{ blocked: boolean }>`
              SELECT EXISTS (
                SELECT 1 FROM pg_stat_activity
                WHERE datname = current_database()
                  AND pid <> pg_backend_pid()
                  AND wait_event_type = 'Lock'
                  AND (query LIKE '%from "invitations"%' OR query LIKE '%from "users"%')
                  AND cardinality(pg_blocking_pids(pid)) > 0
              ) AS blocked
            `.execute(database);
            if (result.rows[0]?.blocked) return;
          }
          throw new Error('Contention observation stopped');
        },
      };
    },
    reset: connection.reset,
    close: connection.close,
  };
}
