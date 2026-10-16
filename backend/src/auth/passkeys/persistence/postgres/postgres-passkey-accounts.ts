import { Response } from 'express';
import { Kysely } from 'kysely';
import { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../../session/persistence/postgres/postgres-issuance-mappers';
import { AuthenticatedUserSummary } from '../../../interfaces/authenticated-user.interface';
import {
  rememberSignInAccount,
  SIGN_IN_COLUMNS,
  signInAccountOf,
  toSignInAccount,
} from '../../../persistence/postgres/postgres-sign-in-accounts';
import { secondFactorEnabled } from '../../../../user/persistence/postgres/postgres-account-rows'; // feature:totp
import { FIRST_FACTOR } from '../../../services/sessions/first-factor';
import type { BrowserEvidence } from '../../../../session/types/browser-evidence';
import { SignInCompletion } from '../../../services/sessions/sign-in-completion';
import { autocommit } from '../../../persistence/postgres/postgres-pending-codes-database';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { postgresTransactionOf } from '../../../../common/persistence/postgres/postgres-unit-of-work';
import {
  PasskeyAccount,
  PasskeyAccountPassword,
  PasskeyAccounts,
  PasskeySignIn,
  PasskeySignInOutcome,
  StoredSignInMethods,
} from '../../stores/passkey-accounts';

const NO_CONSTRAINTS: Readonly<Record<string, string>> = {};

/** The accounts passkeys belong to, read from the account tables. */
export class PostgresPasskeyAccounts extends PasskeyAccounts {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  findAccount(userId: string): Promise<PasskeyAccount | null> {
    return autocommit(NO_CONSTRAINTS, async () => {
      const row = await this.database
        .selectFrom('users')
        .select([...SIGN_IN_COLUMNS, 'is_deleted'])
        .where('id', '=', toUuid(userId))
        .executeTakeFirst();
      if (!row) return null;
      const signIn = toSignInAccount(
        row,
        await secondFactorEnabled(this.database, row.id), // feature:totp
      );
      return rememberSignInAccount(
        {
          id: signIn.id,
          email: signIn.email,
          name: signIn.name,
          isDeleted: row.is_deleted,
        },
        signIn,
      );
    });
  }

  findPassword(userId: string): Promise<PasskeyAccountPassword | null> {
    return autocommit(NO_CONSTRAINTS, async () => {
      const row = await this.database
        .selectFrom('users')
        .select('password_hash')
        .where('id', '=', toUuid(userId))
        .executeTakeFirst();
      return row ? { passwordHash: row.password_hash ?? undefined } : null;
    });
  }

  findSignInMethods(userId: string): Promise<StoredSignInMethods | null> {
    return autocommit(NO_CONSTRAINTS, async () => {
      const row = await this.database
        .selectFrom('users')
        .select((select) => [
          'users.password_hash',
          select
            .selectFrom('user_linked_accounts as link')
            .select((link) => link.fn.countAll<string>().as('links'))
            .whereRef('link.user_id', '=', 'users.id')
            .as('links'),
        ])
        .where('users.id', '=', toUuid(userId))
        .executeTakeFirst();
      return row
        ? {
            hasPassword: Boolean(row.password_hash),
            hasLinkedAccount: Number.parseInt(row.links ?? '0', 10) > 0,
          }
        : null;
    });
  }

  /** A share lock: a deactivation waits for the work, or the work sees it. */
  async readStanding(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<{ isDeleted: boolean } | null> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('users')
      .select('is_deleted')
      .where('id', '=', toUuid(userId))
      .forShare()
      .executeTakeFirst();
    return row ? { isDeleted: row.is_deleted } : null;
  }
}

/** Finishes the sign-in with the account the passkey routes read. */
export class PostgresPasskeySignIn extends PasskeySignIn {
  constructor(private readonly completion: SignInCompletion) {
    super();
  }

  issueSession(
    account: PasskeyAccount,
    response: Response,
    evidence: BrowserEvidence,
  ): Promise<AuthenticatedUserSummary> {
    return this.completion.issueSession(
      signInAccountOf(account),
      response,
      evidence,
    );
  }

  completeSignIn(
    account: PasskeyAccount,
    response: Response,
  ): Promise<PasskeySignInOutcome> {
    return this.completion.completeSignIn(
      signInAccountOf(account),
      response,
      FIRST_FACTOR.PASSKEY,
    );
  }
}
