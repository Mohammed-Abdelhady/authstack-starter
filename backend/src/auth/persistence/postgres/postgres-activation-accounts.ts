import { ACCOUNT_CREATION_METHOD } from '../../constants/account-creation';
import { assertPostgresAccountAudience } from '../../../user/persistence/postgres/postgres-account-audience';
import { UserRole } from '../../../user/enums/user-role.enum';
import { Response } from 'express';
import { Kysely } from 'kysely';
import {
  ActivatedAccount,
  ActivationAccounts,
  ActivationSignIn,
  ActivationSignInOutcome,
  AddressConfirmation,
  AddressOwner,
  MovedAccount,
  NewActivatedAccount,
} from '../../pending-codes/activation-accounts';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { AuthProvider } from '../../../user/enums/auth-provider.enum';
import { FIRST_FACTOR } from '../../services/sessions/first-factor';
import { SignInCompletion } from '../../services/sessions/sign-in-completion';
import { SignInAccount } from '../../utils/authenticated-user.util';
import { SIGN_IN_COLUMNS, toSignInAccount } from './postgres-sign-in-accounts';
import {
  accountFailure,
  accountStatement,
} from '../../../user/persistence/postgres/postgres-account-rows';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../session/persistence/postgres/postgres-issuance-mappers';
import { storedAddress } from './postgres-pending-codes-database';
import { newPostgresId } from '../../../common/persistence/postgres/postgres-new-id';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';
import { storedLocale } from '../../../common/constants/locales';

class PostgresActivatedAccount extends ActivatedAccount {
  constructor(readonly signIn: SignInAccount) {
    super();
  }

  get id(): string {
    return this.signIn.id;
  }
}

/** The account an activation stored, for the PostgreSQL adapter only. */
export function activatedSignInAccountOf(
  account: ActivatedAccount,
): SignInAccount {
  if (!(account instanceof PostgresActivatedAccount)) {
    throw new Error('This account was not stored on PostgreSQL');
  }
  return account.signIn;
}

class PostgresMovedAccount extends MovedAccount {
  constructor(
    readonly id: string,
    readonly email: string,
    readonly pendingEmail: string | undefined,
    readonly addressGeneration: number,
  ) {
    super();
  }
}

export class PostgresActivationAccounts extends ActivationAccounts {
  constructor(
    private readonly database: Kysely<PostgresTables>,
    private readonly clock: { now(): Date },
  ) {
    super();
  }

  newAccountId(): string {
    return newPostgresId(this.clock.now());
  }

  findAddressOwner(email: string): Promise<AddressOwner | null> {
    return accountStatement(async () => {
      const row = await this.database
        .selectFrom('users')
        .select(['name', 'is_deleted', 'locale'])
        .where('email', '=', storedAddress(email))
        .executeTakeFirst();
      return row
        ? {
            name: row.name ?? '',
            isDeleted: row.is_deleted,
            locale: storedLocale(row.locale),
          }
        : null;
    });
  }

  isStored(accountId: string): Promise<boolean> {
    return accountStatement(async () => {
      const row = await this.database
        .selectFrom('users')
        .select('id')
        .where('id', '=', toUuid(accountId))
        .executeTakeFirst();
      return row !== undefined;
    });
  }

  findAddressConfirmation(userId: string): Promise<AddressConfirmation | null> {
    return accountStatement(async () => {
      const row = await this.database
        .selectFrom('users')
        .select(['email', 'pending_email', 'is_verified', 'address_generation'])
        .where('id', '=', toUuid(userId))
        .executeTakeFirst();
      return row
        ? {
            email: row.email ?? '',
            pendingEmail: row.pending_email ?? undefined,
            isVerified: row.is_verified,
            addressGeneration: row.address_generation,
          }
        : null;
    });
  }

  async hasActiveAccount(
    unitOfWork: UnitOfWork,
    email: string,
  ): Promise<boolean> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('users')
      .select('id')
      .where('email', '=', storedAddress(email))
      .where('is_deleted', '=', false)
      .executeTakeFirst();
    return row !== undefined;
  }

  async insertActivated(
    unitOfWork: UnitOfWork,
    account: NewActivatedAccount,
  ): Promise<ActivatedAccount> {
    await assertPostgresAccountAudience(
      unitOfWork,
      UserRole.USER,
      account.audience,
    );
    const now = this.clock.now();
    try {
      const row = await postgresTransactionOf(unitOfWork)
        .insertInto('users')
        .values({
          id: toUuid(account.id),
          email: storedAddress(account.email),
          password_hash: account.passwordHash,
          name: account.name.trim(),
          is_verified: true,
          auth_provider: AuthProvider.EMAIL,
          primary_provider: AuthProvider.EMAIL,
          locale: account.locale,
          audience: account.audience ?? null,
          created_at: now,
          updated_at: now,
        })
        .returning(SIGN_IN_COLUMNS)
        .executeTakeFirstOrThrow();
      // A row stored a moment ago in this unit of work has no second factor.
      return new PostgresActivatedAccount(toSignInAccount(row));
    } catch (error) {
      throw accountFailure(error);
    }
  }

  async readMovedAccount(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<MovedAccount | null> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('users')
      .select(['id', 'email', 'pending_email', 'address_generation'])
      .where('id', '=', toUuid(userId))
      .where('is_deleted', '=', false)
      .forNoKeyUpdate()
      .noWait()
      .executeTakeFirst();
    return row
      ? new PostgresMovedAccount(
          row.id,
          row.email ?? '',
          row.pending_email ?? undefined,
          row.address_generation,
        )
      : null;
  }

  async confirmAddress(
    unitOfWork: UnitOfWork,
    account: MovedAccount,
    email: string,
  ): Promise<void> {
    if (!(account instanceof PostgresMovedAccount)) {
      throw new Error('This account was not read from PostgreSQL');
    }
    try {
      await postgresTransactionOf(unitOfWork)
        .updateTable('users')
        .set({
          email: storedAddress(email),
          pending_email: null,
          is_verified: true,
          updated_at: this.clock.now(),
        })
        .where('id', '=', account.id)
        .execute();
    } catch (error) {
      throw accountFailure(error);
    }
  }
}

/** Finishes the sign-in with the account the activation stored. */
export class PostgresActivationSignIn extends ActivationSignIn {
  constructor(private readonly completion: SignInCompletion) {
    super();
  }

  recordCreationRefusal(clientId: string): Promise<void> {
    return this.completion.recordCreationRefusal(
      clientId,
      ACCOUNT_CREATION_METHOD.PASSWORD,
    );
  }

  complete(
    account: ActivatedAccount,
    response: Response,
  ): Promise<ActivationSignInOutcome> {
    return this.completion.completeSignIn(
      activatedSignInAccountOf(account),
      response,
      FIRST_FACTOR.EMAIL_CODE,
    );
  }
}
