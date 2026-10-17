import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/postgres/server/postgres-test-server';
import { openTestConnection } from '../../../../test/postgres/postgres-connection';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import { PostgresUnitOfWorkRunner } from '../../../common/persistence/postgres/postgres-unit-of-work';
import {
  removeExpiredRows,
  RETENTION_RULES,
} from '../../../common/persistence/postgres/postgres-retention';
import { PostgresProviderTokenStore } from './persistence/postgres/postgres-provider-token.store';
import { describeProviderTokensContract } from './provider-tokens.contract.harness-spec';

describeProviderTokensContract(
  'PostgreSQL',
  async () => {
    const connection = await openTestConnection();
    const clock = new FrozenClock(TEST_NOW);
    return {
      store: new PostgresProviderTokenStore(connection.database),
      clock,
      userId: '00000000-0000-4000-8000-000000000001',
      unitOfWork: new PostgresUnitOfWorkRunner(connection.database),
      reset: async () => {
        await connection.rollBackOpenWork();
        await connection.database.deleteFrom('provider_revocations').execute();
        await connection.database.deleteFrom('provider_tokens').execute();
        await connection.reset();
      },
      close: connection.close,
      checkSetup: async () => {
        expect(connection.appliedMigrations).toContain(
          '0032_provider_revocations.sql',
        );
        const indexes = await connection.pool.query<{ indexname: string }>(
          "SELECT indexname FROM pg_indexes WHERE tablename IN ('provider_tokens', 'provider_revocations')",
        );
        expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(
          expect.arrayContaining([
            'provider_token_identity_client_unique',
            'provider_token_check_after',
            'provider_revocation_due',
            'provider_revocation_flagged',
            'provider_revocation_purge_after',
          ]),
        );
        const constraints = await connection.pool.query<{ conname: string }>(
          "SELECT conname FROM pg_constraint WHERE conrelid IN ('provider_tokens'::regclass, 'provider_revocations'::regclass)",
        );
        expect(constraints.rows.map(({ conname }) => conname)).toEqual(
          expect.arrayContaining([
            'provider_token_identity_client_unique',
            'provider_revocation_reason',
            'provider_revocation_state',
            'provider_revocation_attempts_nonnegative',
            'provider_revocation_token_whole',
            'provider_revocation_token_only_pending',
            'provider_revocation_pending_has_token',
          ]),
        );
      },
      cleanUp: async () => {
        const pass = await removeExpiredRows(
          connection.database,
          clock.now(),
          undefined,
          RETENTION_RULES.filter(
            ({ table }) => table === 'provider_revocations',
          ),
        );
        expect(pass.failed).toEqual([]);
      },
      link: async (subject) => {
        const account = await connection.pool.query<{ id: string }>(
          "INSERT INTO users (email, name) VALUES ($1, 'Contract') RETURNING id",
          [`${subject}@example.test`],
        );
        await connection.pool.query(
          "INSERT INTO user_linked_accounts (user_id, provider, provider_id, linked_at) VALUES ($1, 'apple', $2, $3)",
          [account.rows[0]?.id, subject, TEST_NOW],
        );
      },
      tokenRows: async () => {
        const rows = await connection.database
          .selectFrom('provider_tokens')
          .selectAll()
          .orderBy('client_id')
          .execute();
        return rows.map((row) => ({
          provider: row.provider,
          subject: row.subject,
          clientId: row.client_id,
          sealed: {
            ciphertext: row.ciphertext,
            iv: row.iv,
            tag: row.tag,
            keyId: row.key_id,
          },
          storedAt: row.stored_at,
        }));
      },
      jobRows: async () => {
        const rows = await connection.database
          .selectFrom('provider_revocations')
          .selectAll()
          .execute();
        return rows.map((row) => ({
          id: row.id,
          subject: row.subject,
          clientId: row.client_id,
          state: row.state,
          outcome: row.outcome,
          attempts: row.attempts,
          failureCode: row.failure_code,
          flaggedAt: row.flagged_at,
          nextAttemptAt: row.next_attempt_at,
          leaseUntil: row.lease_until,
          settledAt: row.settled_at,
          purgeAfter: row.purge_after,
          sealed:
            row.ciphertext !== null &&
            row.iv !== null &&
            row.tag !== null &&
            row.key_id !== null
              ? {
                  ciphertext: row.ciphertext,
                  iv: row.iv,
                  tag: row.tag,
                  keyId: row.key_id,
                }
              : null,
        }));
      },
    };
  },
  {
    bootMs: POSTGRES_BOOT_TIMEOUT_MS,
    resetMs: POSTGRES_RESET_TIMEOUT_MS,
    teardownMs: POSTGRES_TEARDOWN_TIMEOUT_MS,
  },
  true,
);
