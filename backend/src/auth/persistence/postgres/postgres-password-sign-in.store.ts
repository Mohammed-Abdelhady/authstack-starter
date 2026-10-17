import { Kysely } from 'kysely';
import {
  PasswordCandidate,
  PasswordSignInStore,
} from '../../stores/password-sign-in.store';
import { StoredAccount } from '../../../user/stores/stored-account';
import {
  ACCOUNT_COLUMNS,
  accountStatement,
  linkedAccountsOf,
  secondFactorEnabled, // feature:totp
  storedId,
  toStoredAccount,
} from '../../../user/persistence/postgres/postgres-account-rows';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';
import { toUuid } from '../../../session/persistence/postgres/postgres-issuance-mappers';
import { storedAddress } from './postgres-pending-codes-database';

/**
 * The address has one unique rule, so at most one row answers. An address is
 * stored trimmed and in lower case, and looked up the same way.
 */
export class PostgresPasswordSignInStore extends PasswordSignInStore {
  constructor(
    private readonly database: Kysely<PostgresTables>,
    private readonly clock: { now(): Date },
  ) {
    super();
  }

  findForPasswordCheck(email: string): Promise<PasswordCandidate | null> {
    return accountStatement(async () => {
      const row = await this.database
        .selectFrom('users')
        .select([...ACCOUNT_COLUMNS, 'password_hash'])
        .where('email', '=', storedAddress(email))
        .executeTakeFirst();
      if (!row) return null;
      return {
        account: toStoredAccount(
          row,
          await linkedAccountsOf(this.database, row.id),
          await secondFactorEnabled(this.database, row.id), // feature:totp
        ),
        passwordHash: row.password_hash ?? undefined,
      };
    });
  }

  findActiveByAddress(email: string): Promise<StoredAccount | null> {
    return accountStatement(async () => {
      const row = await this.database
        .selectFrom('users')
        .select(ACCOUNT_COLUMNS)
        .where('email', '=', storedAddress(email))
        .where('is_deleted', '=', false)
        .executeTakeFirst();
      return row
        ? toStoredAccount(
            row,
            await linkedAccountsOf(this.database, row.id),
            await secondFactorEnabled(this.database, row.id), // feature:totp
          )
        : null;
    });
  }

  storeNewPassword(
    account: StoredAccount,
    passwordHash: string,
  ): Promise<void> {
    const id = storedId(account);
    return accountStatement(async () => {
      await this.database
        .updateTable('users')
        .set({ password_hash: passwordHash, updated_at: this.clock.now() })
        .where('id', '=', id)
        .execute();
    });
  }

  async storeNewPasswordIn(
    unitOfWork: UnitOfWork,
    userId: string,
    expectedSessionVersion: number,
    passwordHash: string,
  ): Promise<boolean> {
    const updated = await postgresTransactionOf(unitOfWork)
      .updateTable('users')
      .set({ password_hash: passwordHash, updated_at: this.clock.now() })
      .where('id', '=', toUuid(userId))
      .where('is_deleted', '=', false)
      .where('session_version', '=', expectedSessionVersion)
      .returning('id')
      .executeTakeFirst();
    return updated !== undefined;
  }
}
