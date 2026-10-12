import { Kysely } from 'kysely';
import {
  NewProviderAccount,
  ProviderIdentity,
  ProviderSignInStore,
} from '../../stores/provider-sign-in.store';
import { StoredAccount } from '../../../../user/stores/stored-account';
import {
  accountStatement,
  readAccount,
  storedId,
} from '../../../../user/persistence/postgres/postgres-account-rows';
import { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';
import { storedAddress } from '../../../persistence/postgres/postgres-pending-codes-database';

/**
 * Links are rows of their own, so each write here is one transaction over the
 * account and its link: a refused link leaves the account as it was, and a
 * refused address leaves no link behind.
 */
export class PostgresProviderSignInStore extends ProviderSignInStore {
  constructor(
    private readonly database: Kysely<PostgresTables>,
    private readonly clock: { now(): Date },
  ) {
    super();
  }

  findByIdentity(identity: ProviderIdentity): Promise<StoredAccount | null> {
    return accountStatement(async () => {
      const link = await this.database
        .selectFrom('user_linked_accounts')
        .select('user_id')
        .where('provider', '=', identity.provider)
        .where('provider_id', '=', identity.providerId)
        .executeTakeFirst();
      return link ? readAccount(this.database, link.user_id) : null;
    });
  }

  findByAddress(email: string): Promise<StoredAccount | null> {
    return accountStatement(async () => {
      const row = await this.database
        .selectFrom('users')
        .select('id')
        .where('email', '=', storedAddress(email))
        .executeTakeFirst();
      return row ? readAccount(this.database, row.id) : null;
    });
  }

  linkFirstSignIn(
    account: StoredAccount,
    identity: ProviderIdentity,
  ): Promise<StoredAccount> {
    const id = storedId(account);
    return this.stored(async () => {
      await this.database.transaction().execute(async (work) => {
        const now = this.clock.now();
        await work
          .insertInto('user_linked_accounts')
          .values({
            user_id: id,
            provider: identity.provider,
            provider_id: identity.providerId,
            linked_at: now,
          })
          .execute();
        await work
          .updateTable('users')
          .set((user) => ({
            is_verified: true,
            primary_provider: user.fn.coalesce(
              'primary_provider',
              user.val(identity.provider),
            ),
            updated_at: now,
          }))
          .where('id', '=', id)
          .execute();
      });
      return id;
    });
  }

  createFromProvider(account: NewProviderAccount): Promise<StoredAccount> {
    return this.stored(() =>
      this.database.transaction().execute(async (work) => {
        const now = this.clock.now();
        const created = await work
          .insertInto('users')
          .values({
            email: storedAddress(account.email),
            name: account.name.trim(),
            avatar_url: account.avatarUrl ?? null,
            is_verified: true,
            auth_provider: account.provider,
            primary_provider: account.provider,
            role: account.role,
            created_at: now,
            updated_at: now,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await work
          .insertInto('user_linked_accounts')
          .values({
            user_id: created.id,
            provider: account.provider,
            provider_id: account.providerId,
            linked_at: now,
          })
          .execute();
        return created.id;
      }),
    );
  }

  /** Runs the write, then answers with the account as it is stored. */
  private stored(write: () => Promise<string>): Promise<StoredAccount> {
    return accountStatement(async () => {
      const saved = await readAccount(this.database, await write());
      if (!saved) {
        throw new Error('the account vanished while it was saved');
      }
      return saved;
    });
  }
}
