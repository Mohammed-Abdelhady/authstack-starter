import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../test/postgres/server/postgres-test-server';
import { openTestConnection } from '../../../test/postgres/postgres-connection';
import { FrozenClock, TEST_NOW } from '../../../test/utils/frozen-clock';
import { PostgresProviderLinkTicketStore } from './persistence/postgres/postgres-provider-link-ticket.store';
import { describeProviderLinkContract } from './provider-link.contract.harness-spec';

describeProviderLinkContract(
  'PostgreSQL',
  async () => {
    const connection = await openTestConnection();
    return {
      store: new PostgresProviderLinkTicketStore(connection.database),
      clock: new FrozenClock(TEST_NOW),
      userId: '00000000-0000-4000-8000-000000000001',
      otherUserId: '00000000-0000-4000-8000-000000000002',
      reset: async () => {
        await connection.rollBackOpenWork();
        await connection.database.deleteFrom('provider_link_tickets').execute();
        await connection.reset();
      },
      close: connection.close,
      checkSetup: async () => {
        expect(connection.appliedMigrations).toContain(
          '0029_account_erasure.sql',
        );
        const indexes = await connection.pool.query<{ indexname: string }>(
          "SELECT indexname FROM pg_indexes WHERE tablename = 'provider_link_tickets'",
        );
        expect(indexes.rows.map((row) => row.indexname)).toEqual(
          expect.arrayContaining([
            'provider_link_ticket_hash_unique',
            'provider_link_ticket_owner',
            'provider_link_ticket_expires_at',
          ]),
        );
        const constraints = await connection.pool.query<{ conname: string }>(
          "SELECT conname FROM pg_constraint WHERE conrelid = 'provider_link_tickets'::regclass",
        );
        expect(constraints.rows.map((row) => row.conname)).toContain(
          'provider_link_ticket_hash_unique',
        );
      },
    };
  },
  {
    bootMs: POSTGRES_BOOT_TIMEOUT_MS,
    resetMs: POSTGRES_RESET_TIMEOUT_MS,
    teardownMs: POSTGRES_TEARDOWN_TIMEOUT_MS,
  },
);
