import { LinkedAccountsContractHarness } from '../../src/user/linked-accounts-contract/linked-accounts-contract.harness-spec';
import { PostgresLinkedAccountStore } from '../../src/user/persistence/postgres/postgres-linked-account.store';
import { PostgresProviderSignInStore } from '../../src/auth/oauth/persistence/postgres/postgres-provider-sign-in.store';
import { PostgresSignInMethodStore } from '../../src/user/persistence/postgres/postgres-sign-in-method.store';
import { bootPostgresAccountsHarness } from './postgres-accounts-harness';

export async function bootPostgresLinkedAccountsHarness(): Promise<LinkedAccountsContractHarness> {
  const accounts = await bootPostgresAccountsHarness();
  const { database, clock } = accounts;

  return Object.assign(accounts, {
    links: new PostgresLinkedAccountStore(database, clock),
    providerSignIn: new PostgresProviderSignInStore(database, clock),
    signInMethods: new PostgresSignInMethodStore(database),
    storedLinks: async (userId: string) => {
      const rows = await database
        .selectFrom('user_linked_accounts')
        .select(['provider', 'provider_id'])
        .where('user_id', '=', userId)
        .orderBy('id')
        .execute();
      return rows.map((row) => ({
        provider: row.provider,
        providerId: row.provider_id,
      }));
    },
    syncFacts: async (userId: string) => {
      const row = await database
        .selectFrom('users')
        .select([
          'name',
          'avatar_url',
          'primary_provider',
          'last_synced_provider',
          'profile_synced_at',
        ])
        .where('id', '=', userId)
        .executeTakeFirst();
      if (!row) return null;
      return {
        name: row.name ?? '',
        avatarUrl: row.avatar_url,
        primaryProvider: row.primary_provider,
        lastSyncedProvider: row.last_synced_provider,
        profileSyncedAt: row.profile_synced_at,
      };
    },
    markSynced: async (userId: string, at: Date | null) => {
      await database
        .updateTable('users')
        .set({ profile_synced_at: at })
        .where('id', '=', userId)
        .execute();
    },
    setAuthProvider: async (userId: string, provider: string) => {
      await database
        .updateTable('users')
        .set({ auth_provider: provider })
        .where('id', '=', userId)
        .execute();
    },
  });
}
