import { sql } from 'kysely';
import { PostgresActivationAccounts } from '../../src/auth/persistence/postgres/postgres-activation-accounts';
import { PostgresAdminRosterStore } from '../../src/admin/persistence/postgres/postgres-admin-roster.store';
import { PostgresUnitOfWorkRunner } from '../../src/common/persistence/postgres/postgres-unit-of-work';
import { withPasskeyColumns } from '../../src/auth/passkeys/persistence/postgres/postgres-passkey.tables'; // feature:passkeys
import { AdminRosterHarness } from '../utils/admin-roster-contract/admin-roster-harness';
import { TEST_NOW, FrozenClock } from '../utils/frozen-clock';
import { openTestConnection } from './postgres-connection';

export async function bootPostgresAdminRosterHarness(): Promise<AdminRosterHarness> {
  const connection = await openTestConnection();
  const { database } = connection;
  let credentialSequence = 0; // feature:passkeys
  return {
    roster: new PostgresAdminRosterStore(),
    activation: new PostgresActivationAccounts(
      database,
      new FrozenClock(TEST_NOW),
    ),
    runner: (pause) => new PostgresUnitOfWorkRunner(database, pause),
    seedAccount: async (input) => {
      const row = await database
        .insertInto('users')
        .values({
          email: input.email,
          role: input.role ?? 'user',
          is_deleted: input.deleted ?? false,
          is_verified: input.verified ?? false,
          pending_email: input.pendingEmail ?? null,
          pending_email_initiator: input.pendingEmailInitiator ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },
    // feature:passkeys:start
    seedPasskey: async (userId, rpId) => {
      await withPasskeyColumns(database)
        .insertInto('passkeys')
        .values({
          user_id: userId,
          rp_id: rpId ?? null,
          credential_id: `roster-credential-${credentialSequence++}`,
          public_key: Buffer.from([7, 7, 7]),
          counter: 0,
          name: 'Roster key',
          created_at: TEST_NOW,
          updated_at: TEST_NOW,
        })
        .execute();
    },
    // feature:passkeys:end
    contention: () => {
      let stopped = false;
      return {
        runner: new PostgresUnitOfWorkRunner(database),
        stop: () => {
          stopped = true;
        },
        blocked: async () => {
          while (!stopped) {
            const waiting = await sql<{ blocked: boolean }>`
              SELECT EXISTS (
                SELECT 1 FROM pg_stat_activity
                 WHERE datname = current_database()
                   AND pid <> pg_backend_pid()
                   AND wait_event_type = 'Lock'
                   AND query LIKE '%pg_advisory_xact_lock%'
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
