import { PostgresAddressLedger } from '../../src/common/persistence/postgres/postgres-address-ledger';
import { PostgresUnitOfWorkRunner } from '../../src/common/persistence/postgres/postgres-unit-of-work';
import { MagicLinkContractHarness } from '../../src/auth/magic-link/contract/magic-link-contract.harness-spec';
import { FrozenClock, TEST_NOW } from '../utils/frozen-clock';
import {
  PostgresMagicLinkAccounts,
  PostgresMagicLinkStore,
} from '../../src/auth/magic-link/persistence/postgres/postgres-magic-link.store';
import { openTestConnection } from './postgres-connection';

export async function bootPostgresMagicLinkHarness(): Promise<MagicLinkContractHarness> {
  const connection = await openTestConnection();
  const { database } = connection;
  const countRows = async (
    table: 'pending_magic_links' | 'users' | 'address_claims',
  ): Promise<number> => {
    const row = await database
      .selectFrom(table)
      .select((select) => select.fn.countAll<string>().as('rows'))
      .executeTakeFirstOrThrow();
    return Number(row.rows);
  };

  return {
    clock: new FrozenClock(TEST_NOW),
    ledger: new PostgresAddressLedger(),
    links: new PostgresMagicLinkStore(database),
    accounts: new PostgresMagicLinkAccounts(database),
    runner: new PostgresUnitOfWorkRunner(database),

    seedLink: async (link) => {
      await database
        .insertInto('pending_magic_links')
        .values({
          email: link.email,
          token_hash: link.tokenHash,
          expires_at: link.expiresAt,
          created_at: link.createdAt,
          consumed_at: link.consumedAt ?? null,
          redirect: link.redirect ?? null,
        })
        .execute();
    },
    link: async (tokenHash) => {
      const row = await database
        .selectFrom('pending_magic_links')
        .selectAll()
        .where('token_hash', '=', tokenHash)
        .executeTakeFirst();
      return row
        ? {
            email: row.email,
            tokenHash: row.token_hash,
            expiresAt: row.expires_at,
            consumedAt: row.consumed_at,
            requestIp: row.request_ip,
            userAgent: row.user_agent,
            redirect: row.redirect,
          }
        : null;
    },
    linkCount: () => countRows('pending_magic_links'),

    seedAccount: async (account) => {
      const row = await database
        .insertInto('users')
        .values({
          email: account.email,
          name: 'Contract Tester',
          is_verified: account.isVerified,
          is_deleted: account.isDeleted,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },
    account: async (email) => {
      const row = await database
        .selectFrom('users')
        .select(['id', 'name', 'is_verified', 'is_deleted', 'auth_provider'])
        .where('email', '=', email)
        .executeTakeFirst();
      return row
        ? {
            id: row.id,
            name: row.name,
            isVerified: row.is_verified,
            isDeleted: row.is_deleted,
            authProvider: row.auth_provider,
          }
        : null;
    },
    accountCount: () => countRows('users'),
    claimCount: () => countRows('address_claims'),

    reset: connection.reset,
    close: connection.close,
  };
}
