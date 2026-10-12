import { Kysely, sql } from 'kysely';
import {
  AccountGrants,
  AccountPermissionStore,
} from '../../stores/account-permission.store';
import { StoredAccount } from '../../stores/stored-account';
import {
  accountStatement,
  readAccount,
  storedId,
} from './postgres-account-rows';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../session/persistence/postgres/postgres-issuance-mappers';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PostgresAccountPermissionStore extends AccountPermissionStore {
  constructor(
    private readonly database: Kysely<PostgresTables>,
    private readonly clock: { now(): Date },
  ) {
    super();
  }

  isAccountId(id: string): boolean {
    return UUID_PATTERN.test(id);
  }

  findGrants(userId: string): Promise<AccountGrants | null> {
    return accountStatement(async () => {
      const row = await this.database
        .selectFrom('users')
        .select(['id', 'role', 'permissions'])
        .where('id', '=', toUuid(userId))
        .executeTakeFirst();
      if (!row) return null;
      return {
        id: row.id,
        role: row.role,
        permissions: row.permissions,
      };
    });
  }

  findAccount(userId: string): Promise<StoredAccount | null> {
    return accountStatement(() => readAccount(this.database, userId));
  }

  grantPermission(
    account: StoredAccount,
    permission: string,
  ): Promise<string[]> {
    return accountStatement(async () => {
      const row = await this.database
        .updateTable('users')
        .set({
          permissions: sql<string[]>`array_append(permissions, ${permission})`,
          updated_at: this.clock.now(),
        })
        .where('id', '=', storedId(account))
        .returning('permissions')
        .executeTakeFirstOrThrow();
      return row.permissions;
    });
  }

  revokePermission(
    account: StoredAccount,
    permission: string,
  ): Promise<string[]> {
    return accountStatement(async () => {
      const row = await this.database
        .updateTable('users')
        .set({
          permissions: sql<string[]>`array_remove(permissions, ${permission})`,
          updated_at: this.clock.now(),
        })
        .where('id', '=', storedId(account))
        .returning('permissions')
        .executeTakeFirstOrThrow();
      return row.permissions;
    });
  }
}
