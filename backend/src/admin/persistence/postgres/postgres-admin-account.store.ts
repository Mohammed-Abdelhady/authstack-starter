import { Kysely, Transaction } from 'kysely';
import {
  AccountIdentityEdit,
  AdminAccountPage,
  AdminAccountQuery,
  AdminAccountStore,
  AssignableRole,
  CreatedAccountMark,
  NewAdminAccount,
} from '../../stores/admin-account.store';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { AuthProvider } from '../../../user/enums/auth-provider.enum';
import {
  LinkedAccountRecord,
  StoredAccount,
} from '../../../user/stores/stored-account';
import {
  ACCOUNT_COLUMNS,
  accountFailure,
  accountStatement,
  readAccount,
  storedId,
  toStoredAccount,
} from '../../../user/persistence/postgres/postgres-account-rows';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import { anyUuid } from '../../../session/persistence/postgres/postgres-bind-parameters';
import { toUuid } from '../../../session/persistence/postgres/postgres-issuance-mappers';
import { storedAddress } from '../../../auth/persistence/postgres/postgres-pending-codes-database';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';

type Work = Transaction<PostgresTables>;

const SORT_COLUMNS: Readonly<
  Record<string, 'created_at' | 'updated_at' | 'email' | 'name' | 'role'>
> = {
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  email: 'email',
  name: 'name',
  role: 'role',
};

/** `%`, `_` and the escape itself are taken literally in a search. */
function literalPattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (special) => `\\${special}`)}%`;
}

/**
 * Takes the target at `takeAccountForChange` with a row lock, the one sign-in
 * takes on an account. A second unit of work is refused there at once
 * (`NOWAIT`), which the runner reports as a retryable abort.
 */
export class PostgresAdminAccountStore extends AdminAccountStore {
  constructor(
    private readonly database: Kysely<PostgresTables>,
    private readonly clock: { now(): Date },
  ) {
    super();
  }

  findAccount(userId: string): Promise<StoredAccount | null> {
    return accountStatement(() => readAccount(this.database, userId));
  }

  findAccountView(userId: string): Promise<StoredAccount | null> {
    return this.findAccount(userId);
  }

  listAccounts(query: AdminAccountQuery): Promise<AdminAccountPage> {
    return accountStatement(async () => {
      let matching = this.database.selectFrom('users');
      matching =
        query.role && query.viewableRoles.includes(query.role)
          ? matching.where('role', '=', query.role)
          : matching.where('role', 'in', query.viewableRoles);
      if (query.viewableRoles.length === 0) {
        return { accounts: [], total: 0 };
      }
      if (query.search) {
        const pattern = literalPattern(query.search);
        matching = matching.where((user) =>
          user.or([
            user('name', 'ilike', pattern),
            user('email', 'ilike', pattern),
          ]),
        );
      }
      const status = statusFilter(query);
      if (status.isVerified !== undefined) {
        matching = matching.where('is_verified', '=', status.isVerified);
      }
      if (status.isDeleted !== undefined) {
        matching = matching.where('is_deleted', '=', status.isDeleted);
      }
      const counted = await matching
        .select((user) => user.fn.countAll<string>().as('total'))
        .executeTakeFirstOrThrow();
      const rows = await matching
        .select(ACCOUNT_COLUMNS)
        .orderBy(SORT_COLUMNS[query.sortBy] ?? 'created_at', query.sortOrder)
        .orderBy('id', query.sortOrder)
        .offset((query.page - 1) * query.limit)
        .limit(query.limit)
        .execute();
      const links = await linkedAccountsByUser(
        this.database,
        rows.map((row) => row.id),
      );
      return {
        accounts: rows.map((row) =>
          toStoredAccount(row, links.get(row.id) ?? []),
        ),
        total: Number.parseInt(counted.total, 10),
      };
    });
  }

  isAddressTaken(email: string): Promise<boolean> {
    return accountStatement(async () => {
      const row = await this.database
        .selectFrom('users')
        .select('id')
        .where('email', '=', storedAddress(email))
        .executeTakeFirst();
      return row !== undefined;
    });
  }

  findRole(roleId: string): Promise<AssignableRole | null> {
    return accountStatement(async () => {
      const row = await this.database
        .selectFrom('roles')
        .select(['id', 'slug'])
        .where('id', '=', toUuid(roleId))
        .executeTakeFirst();
      return row ?? null;
    });
  }

  findRoleBySlug(slug: string): Promise<AssignableRole | null> {
    return accountStatement(async () => {
      const row = await this.database
        .selectFrom('roles')
        .select(['id', 'slug'])
        .where('slug', '=', slug)
        .executeTakeFirst();
      return row ?? null;
    });
  }

  readAccount(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<StoredAccount | null> {
    return readAccount(postgresTransactionOf(unitOfWork), userId);
  }

  takeEmailChangeTarget(
    uow: UnitOfWork,
    userId: string,
  ): Promise<StoredAccount | null> {
    return readAccount(postgresTransactionOf(uow), userId, true);
  }

  takeAccountForChange(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<StoredAccount | null> {
    return readAccount(postgresTransactionOf(unitOfWork), userId, true);
  }

  async readRoleBySlug(
    unitOfWork: UnitOfWork,
    slug: string,
  ): Promise<AssignableRole | null> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('roles')
      .select(['id', 'slug'])
      .where('slug', '=', slug)
      .executeTakeFirst();
    return row ?? null;
  }

  saveActivation(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    deletedAt: Date | undefined,
  ): Promise<StoredAccount> {
    return this.save(postgresTransactionOf(unitOfWork), storedId(account), {
      is_deleted: deletedAt !== undefined,
      deleted_at: deletedAt ?? null,
    });
  }

  saveRole(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    slug: string,
  ): Promise<StoredAccount> {
    return this.save(postgresTransactionOf(unitOfWork), storedId(account), {
      role: slug,
    });
  }

  saveIdentity(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    edit: AccountIdentityEdit,
  ): Promise<StoredAccount> {
    return this.save(postgresTransactionOf(unitOfWork), storedId(account), {
      ...(edit.name === undefined ? {} : { name: edit.name.trim() }),
      ...(edit.address
        ? {
            pending_email: storedAddress(edit.address.email),
            address_generation: edit.address.addressGeneration,
          }
        : {}),
    });
  }

  savePermissions(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    permissions: string[],
  ): Promise<StoredAccount> {
    return this.save(postgresTransactionOf(unitOfWork), storedId(account), {
      permissions,
    });
  }

  async insertAccount(
    unitOfWork: UnitOfWork,
    account: NewAdminAccount,
  ): Promise<StoredAccount> {
    const now = this.clock.now();
    try {
      const row = await postgresTransactionOf(unitOfWork)
        .insertInto('users')
        .values({
          email: storedAddress(account.email),
          name: account.name.trim(),
          password_hash: account.passwordHash,
          role: account.role,
          is_verified: true,
          permissions: [],
          auth_provider: AuthProvider.EMAIL,
          primary_provider: AuthProvider.EMAIL,
          locale: account.locale,
          created_at: now,
          updated_at: now,
        })
        .returning(ACCOUNT_COLUMNS)
        .executeTakeFirstOrThrow();
      return toStoredAccount(row, []);
    } catch (error) {
      throw accountFailure(error);
    }
  }

  async removeCreatedAccount(
    unitOfWork: UnitOfWork,
    created: CreatedAccountMark,
  ): Promise<void> {
    await postgresTransactionOf(unitOfWork)
      .deleteFrom('users')
      .where('id', '=', toUuid(created.id))
      .where('role', '=', created.role)
      .where('updated_at', '=', created.updatedAt)
      .where('session_version', '=', created.sessionVersion)
      .execute();
  }

  private async save(
    work: Work,
    id: string,
    fields: {
      name?: string;
      email?: string;
      role?: string;
      address_generation?: number;
      pending_email?: string;
      permissions?: string[];
      is_verified?: boolean;
      is_deleted?: boolean;
      deleted_at?: Date | null;
    },
  ): Promise<StoredAccount> {
    try {
      await work
        .updateTable('users')
        .set({ ...fields, updated_at: this.clock.now() })
        .where('id', '=', id)
        .execute();
    } catch (error) {
      throw accountFailure(error);
    }
    const saved = await readAccount(work, id);
    if (!saved) {
      throw new Error('the account vanished inside its own unit of work');
    }
    return saved;
  }
}

/**
 * The links of a page of accounts in one statement, each account's in the
 * order they were made.
 */
async function linkedAccountsByUser(
  database: Kysely<PostgresTables>,
  userIds: string[],
): Promise<Map<string, LinkedAccountRecord[]>> {
  const links = new Map<string, LinkedAccountRecord[]>();
  if (userIds.length === 0) return links;
  const rows = await database
    .selectFrom('user_linked_accounts')
    .select(['user_id', 'provider', 'provider_id', 'linked_at'])
    .where('user_id', '=', anyUuid(userIds))
    .orderBy('id')
    .execute();
  for (const row of rows) {
    const ofUser = links.get(row.user_id) ?? [];
    ofUser.push({
      provider: row.provider,
      providerId: row.provider_id,
      linkedAt: row.linked_at,
    });
    links.set(row.user_id, ofUser);
  }
  return links;
}

function statusFilter(query: AdminAccountQuery): {
  isVerified?: boolean;
  isDeleted?: boolean;
} {
  if (query.status === 'deleted') {
    return { isVerified: query.isVerified, isDeleted: true };
  }
  if (query.status === 'inactive') {
    return { isVerified: false, isDeleted: false };
  }
  if (query.status === 'active') {
    return { isVerified: true, isDeleted: false };
  }
  return { isVerified: query.isVerified };
}
