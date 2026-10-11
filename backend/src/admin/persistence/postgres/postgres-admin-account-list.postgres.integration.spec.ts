import { KyselyPlugin, sql } from 'kysely';
import {
  openTestConnection,
  TestConnection,
} from '../../../../test/postgres/postgres-connection';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/postgres/server/postgres-test-server';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import { ISSUANCE_CONTRACT_CASE_TIMEOUT_MS } from '../../../../test/utils/session/issuance-contract/issuance-contract-harness';
import { AdminAccountQuery } from '../../stores/admin-account.store';
import { PostgresAdminAccountStore } from './postgres-admin-account.store';

const FIRST_LINK = new Date('2098-06-01T00:00:00.000Z');
const SECOND_LINK = new Date('2098-06-02T00:00:00.000Z');
const PAGE_OF_100: AdminAccountQuery = {
  viewableRoles: ['user'],
  page: 1,
  limit: 100,
  sortBy: 'email',
  sortOrder: 'asc',
};

/** Counts the statements a store sends, whatever they say. */
function statementCounter(): { plugin: KyselyPlugin; sent: () => number } {
  let sent = 0;
  return {
    plugin: {
      transformQuery: ({ node }) => {
        sent += 1;
        return node;
      },
      transformResult: ({ result }) => Promise.resolve(result),
    },
    sent: () => sent,
  };
}

/** What listing accounts costs on PostgreSQL, where links are rows of their own. */
describe('PostgreSQL admin account list', () => {
  let connection: TestConnection;

  beforeAll(async () => {
    connection = await openTestConnection();
  }, POSTGRES_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await connection?.close();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await connection.reset();
    await sql`
      INSERT INTO users (email, name, role, created_at, updated_at)
      SELECT 'account-' || lpad(n::text, 3, '0') || '@example.test',
             'Listed', 'user', ${TEST_NOW}, ${TEST_NOW}
        FROM generate_series(1, 120) AS n`.execute(connection.database);
    await sql`
      INSERT INTO user_linked_accounts (user_id, provider, provider_id, linked_at)
      SELECT users.id, link.provider, link.provider_id, link.linked_at
        FROM (VALUES
          ('account-002@example.test', 'provider-a', 'a-2', ${FIRST_LINK}::timestamptz),
          ('account-002@example.test', 'provider-b', 'b-2', ${SECOND_LINK}::timestamptz),
          ('account-100@example.test', 'provider-b', 'b-100', ${FIRST_LINK}::timestamptz),
          ('account-101@example.test', 'provider-a', 'a-101', ${FIRST_LINK}::timestamptz)
        ) AS link (email, provider, provider_id, linked_at)
        JOIN users ON users.email = link.email
       ORDER BY link.linked_at`.execute(connection.database);
  }, POSTGRES_RESET_TIMEOUT_MS);

  it(
    'reads a page of 100 accounts and their links in three statements',
    async () => {
      const counter = statementCounter();
      const store = new PostgresAdminAccountStore(
        connection.database.withPlugin(counter.plugin),
        new FrozenClock(TEST_NOW),
      );

      const page = await store.listAccounts(PAGE_OF_100);

      const linked = page.accounts.filter(
        (account) => account.linkedAccounts.length > 0,
      );
      expect({
        statements: counter.sent(),
        total: page.total,
        listed: page.accounts.length,
        first: page.accounts[0].email,
        last: page.accounts[99].email,
        linked: linked.map((account) => ({
          email: account.email,
          linkedAccounts: account.linkedAccounts,
          linkedProviders: account.linkedProviders,
        })),
      }).toEqual({
        statements: 3,
        total: 120,
        listed: 100,
        first: 'account-001@example.test',
        last: 'account-100@example.test',
        linked: [
          {
            email: 'account-002@example.test',
            linkedAccounts: [
              {
                provider: 'provider-a',
                providerId: 'a-2',
                linkedAt: FIRST_LINK,
              },
              {
                provider: 'provider-b',
                providerId: 'b-2',
                linkedAt: SECOND_LINK,
              },
            ],
            linkedProviders: ['email', 'provider-a', 'provider-b'],
          },
          {
            email: 'account-100@example.test',
            linkedAccounts: [
              {
                provider: 'provider-b',
                providerId: 'b-100',
                linkedAt: FIRST_LINK,
              },
            ],
            linkedProviders: ['email', 'provider-b'],
          },
        ],
      });
    },
    ISSUANCE_CONTRACT_CASE_TIMEOUT_MS,
  );

  it(
    'sends no statement for links when the page is empty',
    async () => {
      const counter = statementCounter();
      const store = new PostgresAdminAccountStore(
        connection.database.withPlugin(counter.plugin),
        new FrozenClock(TEST_NOW),
      );

      const page = await store.listAccounts({ ...PAGE_OF_100, page: 3 });

      expect({
        statements: counter.sent(),
        total: page.total,
        accounts: page.accounts,
      }).toEqual({ statements: 2, total: 120, accounts: [] });
    },
    ISSUANCE_CONTRACT_CASE_TIMEOUT_MS,
  );
});
