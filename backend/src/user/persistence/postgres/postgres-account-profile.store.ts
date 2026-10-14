import { Kysely } from 'kysely';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { PostgresRolePermissions } from '../../../role/persistence/postgres/postgres-role-permissions';
import { RolePermissions } from '../../../role/stores/role-permissions';
import { UserRole } from '../../enums/user-role.enum';
import {
  AccountPassword,
  AccountProfileStore,
  AdminFence,
  ProfileChanges,
} from '../../stores/account-profile.store';
import { StoredAccount } from '../../stores/stored-account';
import {
  accountStatement,
  readAccount,
  storedId,
} from './postgres-account-rows';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../session/persistence/postgres/postgres-issuance-mappers';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Takes the account at `readAccount` with a row lock, the one sign-in takes.
 * The fence is a row lock on the admin role, and it is taken at the count: under
 * read committed a count made before the fence could already be out of date
 * when the fence is reached. A second unit of work is refused at either at once
 * (`NOWAIT`), which the runner reports as a retryable abort.
 */
export class PostgresAccountProfileStore extends AccountProfileStore {
  private readonly roles: RolePermissions;

  constructor(
    private readonly database: Kysely<PostgresTables>,
    private readonly clock: { now(): Date },
  ) {
    super();
    this.roles = new PostgresRolePermissions(database);
  }

  isAccountId(id: string): boolean {
    return UUID_PATTERN.test(id);
  }

  findProfile(userId: string): Promise<StoredAccount | null> {
    return accountStatement(() => readAccount(this.database, userId));
  }

  findAccount(userId: string): Promise<StoredAccount | null> {
    return this.findProfile(userId);
  }

  async saveProfile(
    account: StoredAccount,
    changes: ProfileChanges,
  ): Promise<StoredAccount> {
    const id = storedId(account);
    const saved = await accountStatement(async () => {
      await this.database
        .updateTable('users')
        .set({
          ...(changes.name === undefined ? {} : { name: changes.name.trim() }),
          ...(changes.locale === undefined ? {} : { locale: changes.locale }),
          updated_at: this.clock.now(),
        })
        .where('id', '=', id)
        .execute();
      return readAccount(this.database, id);
    });
    if (!saved) {
      throw new Error('the account vanished while it was saved');
    }
    return saved;
  }

  findPassword(userId: string): Promise<AccountPassword | null> {
    return accountStatement(async () => {
      const row = await this.database
        .selectFrom('users')
        .select(['id', 'is_deleted', 'password_hash'])
        .where('id', '=', toUuid(userId))
        .executeTakeFirst();
      if (!row) return null;
      return {
        id: row.id,
        isDeleted: row.is_deleted,
        passwordHash: row.password_hash ?? undefined,
      };
    });
  }

  findPrimaryProvider(userId: string): Promise<string | undefined> {
    return accountStatement(async () => {
      const row = await this.database
        .selectFrom('users')
        .select('primary_provider')
        .where('id', '=', toUuid(userId))
        .executeTakeFirst();
      return row?.primary_provider ?? undefined;
    });
  }

  findRolePermissions(slug: string): Promise<string[] | null> {
    return accountStatement(() => this.roles.ofRole(slug));
  }

  // feature:passkeys:start
  countPasskeys(userId: string): Promise<number> {
    return accountStatement(async () => {
      const row = await this.database
        .selectFrom('passkeys')
        .select((select) => select.fn.countAll<string>().as('rows'))
        .where('user_id', '=', toUuid(userId))
        .executeTakeFirstOrThrow();
      return Number.parseInt(row.rows, 10);
    });
  }
  // feature:passkeys:end

  readAccount(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<StoredAccount | null> {
    return readAccount(postgresTransactionOf(unitOfWork), userId, true);
  }

  async savePasswordHash(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    passwordHash: string,
  ): Promise<void> {
    await postgresTransactionOf(unitOfWork)
      .updateTable('users')
      .set({ password_hash: passwordHash, updated_at: this.clock.now() })
      .where('id', '=', storedId(account))
      .execute();
  }

  async saveDeactivation(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    deletedAt: Date,
  ): Promise<void> {
    await postgresTransactionOf(unitOfWork)
      .updateTable('users')
      .set({
        is_deleted: true,
        deleted_at: deletedAt,
        updated_at: this.clock.now(),
      })
      .where('id', '=', storedId(account))
      .execute();
  }

  async countOtherActiveAdmins(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<number> {
    await this.takeFence(unitOfWork);
    const counted = await postgresTransactionOf(unitOfWork)
      .selectFrom('users')
      .select((user) => user.fn.countAll<string>().as('total'))
      .where('id', '!=', toUuid(userId))
      .where('role', '=', UserRole.ADMIN)
      .where('is_deleted', '=', false)
      .executeTakeFirstOrThrow();
    return Number.parseInt(counted.total, 10);
  }

  fenceAdminRole(unitOfWork: UnitOfWork): Promise<AdminFence> {
    return this.takeFence(unitOfWork);
  }

  private async takeFence(unitOfWork: UnitOfWork): Promise<AdminFence> {
    const fenced = await postgresTransactionOf(unitOfWork)
      .selectFrom('roles')
      .select('id')
      .where('slug', '=', UserRole.ADMIN)
      .forNoKeyUpdate()
      .noWait()
      .execute();
    return fenced.length === 1 ? 'fenced' : 'role_missing';
  }
}
