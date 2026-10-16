import type { INestApplication } from '@nestjs/common'; // feature:passkeys
import { storedAddress } from '../../src/auth/persistence/postgres/postgres-pending-codes-database';
import type { PostgresDatabase } from '../../src/common/persistence/postgres/postgres-connection';
import { Clock } from '../../src/common/services/clock'; // feature:passkeys
import { withPasskeyColumns } from '../../src/auth/passkeys/persistence/postgres/postgres-passkey.tables'; // feature:passkeys
import type {
  E2eAccountState,
  E2eLinkedAccount,
} from '../utils/e2e-state-auth';

/** Accounts on PostgreSQL, through the adapter's table map. */
export function postgresAccountState(
  database: PostgresDatabase,
  app: INestApplication, // feature:passkeys
): E2eAccountState {
  const idOf = async (email: string): Promise<string> => {
    const owner = await database
      .selectFrom('users')
      .select('id')
      .where('email', '=', storedAddress(email))
      .executeTakeFirstOrThrow();
    return owner.id;
  };
  const replaceLinks = async (
    userId: string,
    links: E2eLinkedAccount[],
  ): Promise<void> => {
    await database
      .deleteFrom('user_linked_accounts')
      .where('user_id', '=', userId)
      .execute();
    if (links.length === 0) return;
    await database
      .insertInto('user_linked_accounts')
      .values(
        links.map((link) => ({
          user_id: userId,
          provider: link.provider,
          provider_id: link.providerId,
          linked_at: link.linkedAt,
        })),
      )
      .execute();
  };

  return {
    countAccountsWithAddress: async (email) => {
      const rows = await database
        .selectFrom('users')
        .select('id')
        .where('email', '=', storedAddress(email))
        .execute();
      return rows.length;
    },
    removePassword: async (email) => {
      await database
        .updateTable('users')
        .set({ password_hash: null })
        .where('email', '=', storedAddress(email))
        .execute();
    },
    linkProviderAccounts: async (email, links) => {
      await replaceLinks(await idOf(email), links);
    },
    makeProviderCreated: async (email, provider, links) => {
      const userId = await idOf(email);
      await database
        .updateTable('users')
        .set({ auth_provider: provider })
        .where('id', '=', userId)
        .execute();
      await replaceLinks(userId, links);
    },
    // feature:passkeys:start
    storePasskey: async (email, passkey) => {
      const at = app.get(Clock, { strict: false }).now();
      const stored = await withPasskeyColumns(database)
        .insertInto('passkeys')
        .values({
          user_id: await idOf(email),
          credential_id: passkey.credentialId,
          public_key: passkey.publicKey,
          counter: passkey.counter,
          transports: passkey.transports,
          device_type: passkey.deviceType,
          backed_up: passkey.backedUp,
          name: passkey.name,
          last_used_at: passkey.lastUsedAt,
          rp_id: passkey.rpId ?? null,
          created_at: at,
          updated_at: at,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return stored.id;
    },
    countPasskeys: async () => {
      const rows = await database.selectFrom('passkeys').select('id').execute();
      return rows.length;
    },
    removeEveryPasskey: async () => {
      await database.deleteFrom('passkeys').execute();
    },
    // feature:passkeys:end
  };
}
