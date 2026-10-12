import { Kysely, Transaction } from 'kysely';
import {
  LinkedAccountStore,
  LinkedProviders,
  PrimaryProviderState,
  SyncedProfile,
  SyncStatus,
} from '../../stores/linked-account.store';
import { linkedProvidersOf, StoredAccount } from '../../stores/stored-account';
import { EMAIL_PROVIDER } from '../../../common/constants/oauth-providers';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  accountStatement,
  linkedAccountsOf,
  readAccount,
  storedId,
} from './postgres-account-rows';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../session/persistence/postgres/postgres-issuance-mappers';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';

/**
 * Links are rows of their own, under one unique rule over provider and
 * provider id. A link and the account's primary provider are written in one
 * transaction, so a refused link leaves the account as it was.
 */
export class PostgresLinkedAccountStore extends LinkedAccountStore {
  constructor(
    private readonly database: Kysely<PostgresTables>,
    private readonly clock: { now(): Date },
  ) {
    super();
  }

  findAccount(userId: string): Promise<StoredAccount | null> {
    return accountStatement(() => readAccount(this.database, userId));
  }

  findLinks(userId: string): Promise<StoredAccount | null> {
    return this.findAccount(userId);
  }

  findLinkedProviders(userId: string): Promise<LinkedProviders | null> {
    return accountStatement(async () => {
      const row = await this.database
        .selectFrom('users')
        .select(['id', 'auth_provider'])
        .where('id', '=', toUuid(userId))
        .executeTakeFirst();
      if (!row) return null;
      return {
        linkedProviders: linkedProvidersOf({
          authProvider: row.auth_provider ?? EMAIL_PROVIDER,
          linkedAccounts: await linkedAccountsOf(this.database, row.id),
        }),
      };
    });
  }

  findPrimaryProviderState(
    userId: string,
  ): Promise<PrimaryProviderState | null> {
    return accountStatement(async () => {
      const row = await this.database
        .selectFrom('users')
        .select(['is_deleted', 'primary_provider'])
        .where('id', '=', toUuid(userId))
        .executeTakeFirst();
      if (!row) return null;
      return {
        isDeleted: row.is_deleted,
        primaryProvider: row.primary_provider ?? undefined,
      };
    });
  }

  addLink(
    account: StoredAccount,
    link: { provider: string; providerId: string; primaryProvider?: string },
  ): Promise<StoredAccount> {
    const id = storedId(account);
    return this.change(id, async (work) => {
      await work
        .insertInto('user_linked_accounts')
        .values({
          user_id: id,
          provider: link.provider,
          provider_id: link.providerId,
          linked_at: this.clock.now(),
        })
        .execute();
      await this.touch(work, id, {
        ...(link.primaryProvider === undefined
          ? {}
          : { primary_provider: link.primaryProvider }),
      });
    });
  }

  readAccount(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<StoredAccount | null> {
    return readAccount(postgresTransactionOf(unitOfWork), userId);
  }

  async removeLink(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    unlink: { provider: string; primaryProvider: string | undefined },
  ): Promise<StoredAccount> {
    const id = storedId(account);
    const work = postgresTransactionOf(unitOfWork);
    await work
      .deleteFrom('user_linked_accounts')
      .where('user_id', '=', id)
      .where('provider', '=', unlink.provider)
      .execute();
    await this.touch(work, id, {
      primary_provider: unlink.primaryProvider ?? null,
    });
    const saved = await readAccount(work, id);
    if (!saved) {
      throw new Error('the account vanished while it was saved');
    }
    return saved;
  }

  savePrimaryProvider(
    account: StoredAccount,
    provider: string,
  ): Promise<StoredAccount> {
    const id = storedId(account);
    return this.change(id, (work) =>
      this.touch(work, id, { primary_provider: provider }),
    );
  }

  findSyncTarget(userId: string): Promise<StoredAccount | null> {
    return this.findAccount(userId);
  }

  saveSyncedProfile(
    account: StoredAccount,
    profile: SyncedProfile,
  ): Promise<StoredAccount> {
    const id = storedId(account);
    return this.change(id, (work) =>
      this.touch(work, id, {
        ...(profile.name === undefined ? {} : { name: profile.name.trim() }),
        ...(profile.avatarUrl === undefined
          ? {}
          : { avatar_url: profile.avatarUrl }),
        profile_synced_at: profile.profileSyncedAt,
        last_synced_provider: profile.lastSyncedProvider,
      }),
    );
  }

  findSyncSource(userId: string): Promise<{ primaryProvider?: string } | null> {
    return this.primaryProviderOf(userId);
  }

  findSyncStatus(userId: string): Promise<SyncStatus | null> {
    return accountStatement(async () => {
      const row = await this.database
        .selectFrom('users')
        .select([
          'profile_synced_at',
          'last_synced_provider',
          'primary_provider',
        ])
        .where('id', '=', toUuid(userId))
        .executeTakeFirst();
      if (!row) return null;
      return {
        profileSyncedAt: row.profile_synced_at ?? undefined,
        lastSyncedProvider: row.last_synced_provider ?? undefined,
        primaryProvider: row.primary_provider ?? undefined,
      };
    });
  }

  findConflictSource(
    userId: string,
  ): Promise<{ primaryProvider?: string } | null> {
    return this.primaryProviderOf(userId);
  }

  countDueForSync(
    before: Date,
    primaryProviderNot: string,
    limit: number,
  ): Promise<number> {
    return accountStatement(async () => {
      const due = await this.database
        .selectFrom('users')
        .select('id')
        .where((user) =>
          user.or([
            user('primary_provider', 'is', null),
            user('primary_provider', '!=', primaryProviderNot),
          ]),
        )
        .where((user) =>
          user.or([
            user('profile_synced_at', 'is', null),
            user('profile_synced_at', '<', before),
          ]),
        )
        .limit(limit)
        .execute();
      return due.length;
    });
  }

  private primaryProviderOf(
    userId: string,
  ): Promise<{ primaryProvider?: string } | null> {
    return accountStatement(async () => {
      const row = await this.database
        .selectFrom('users')
        .select('primary_provider')
        .where('id', '=', toUuid(userId))
        .executeTakeFirst();
      return row
        ? { primaryProvider: row.primary_provider ?? undefined }
        : null;
    });
  }

  private async touch(
    work: Transaction<PostgresTables>,
    id: string,
    fields: {
      name?: string;
      avatar_url?: string;
      primary_provider?: string | null;
      profile_synced_at?: Date;
      last_synced_provider?: string;
    },
  ): Promise<void> {
    await work
      .updateTable('users')
      .set({ ...fields, updated_at: this.clock.now() })
      .where('id', '=', id)
      .execute();
  }

  /** One transaction for the change, then the account as it is stored. */
  private change(
    id: string,
    write: (work: Transaction<PostgresTables>) => Promise<void>,
  ): Promise<StoredAccount> {
    return accountStatement(async () => {
      const saved = await this.database.transaction().execute(async (work) => {
        await write(work);
        return readAccount(work, id);
      });
      if (!saved) {
        throw new Error('the account vanished while it was saved');
      }
      return saved;
    });
  }
}
