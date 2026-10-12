import { Response } from 'express';
import { Kysely, Transaction } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { MalformedIdError } from '../../../../common/persistence/persistence-errors';
import {
  SecondFactorAccount,
  StoredTotpSecret,
} from '../../stores/second-factor-account';
import {
  ATTEMPT_RESERVATION,
  AttemptReservation,
  CountedAttempt,
  SecondFactorConfirmation,
  SecondFactorStore,
  SPEND_OUTCOME,
  SpendOutcome,
} from '../../stores/second-factor.store';
import { SecondFactorSignIn } from '../../stores/second-factor-sign-in';
import { AuthenticatedUserSummary } from '../../../interfaces/authenticated-user.interface';
import {
  rememberSignInAccount,
  signInAccountOf,
  toSignInAccount,
} from '../../../persistence/postgres/postgres-sign-in-accounts';
import { SignInCompletion } from '../../../services/sessions/sign-in-completion';
import { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../../session/persistence/postgres/postgres-issuance-mappers';
import { autocommit } from '../../../persistence/postgres/postgres-pending-codes-database';

const NO_CONSTRAINTS: Readonly<Record<string, string>> = {};

/**
 * The second factor in rows of its own: one per account for the state and one
 * per recovery code. A change that touches both is one transaction, so it is
 * whole or leaves the account as it was.
 */
export class PostgresSecondFactorStore extends SecondFactorStore {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  isAccountId(id: string): boolean {
    try {
      toUuid(id);
      return true;
    } catch (error) {
      if (error instanceof MalformedIdError) return false;
      throw error;
    }
  }

  findAccount(userId: string): Promise<SecondFactorAccount | null> {
    return this.read(userId, false);
  }

  findAccountWithPassword(userId: string): Promise<SecondFactorAccount | null> {
    return this.read(userId, true);
  }

  findChallengedAccount(userId: string): Promise<SecondFactorAccount | null> {
    return this.read(userId, false);
  }

  savePendingSecret(
    account: SecondFactorAccount,
    secret: StoredTotpSecret,
  ): Promise<void> {
    const id = toUuid(account.id);
    const pending = {
      enabled: false,
      secret_ciphertext: secret.ciphertext,
      secret_iv: secret.iv,
      secret_tag: secret.tag,
      confirmed_at: null,
      last_used_step: null,
      failed_attempts: 0,
      locked_until: null,
    };
    return this.change(async (work) => {
      await work
        .insertInto('user_two_factor')
        .values({ user_id: id, ...pending })
        .onConflict((conflict) =>
          conflict.column('user_id').doUpdateSet(pending),
        )
        .execute();
      await this.replaceCodes(work, id, []);
    });
  }

  saveConfirmation(
    account: SecondFactorAccount,
    confirmation: SecondFactorConfirmation,
  ): Promise<void> {
    const id = toUuid(account.id);
    const confirmed = {
      enabled: true,
      confirmed_at: confirmation.confirmedAt,
    };
    return this.change(async (work) => {
      await work
        .insertInto('user_two_factor')
        .values({ user_id: id, ...confirmed })
        .onConflict((conflict) =>
          conflict.column('user_id').doUpdateSet(confirmed),
        )
        .execute();
      await this.replaceCodes(work, id, confirmation.recoveryCodeHashes);
    });
  }

  replaceRecoveryCodes(
    account: SecondFactorAccount,
    recoveryCodeHashes: string[],
  ): Promise<void> {
    const id = toUuid(account.id);
    return this.change((work) =>
      this.replaceCodes(work, id, recoveryCodeHashes),
    );
  }

  replaceSecret(
    account: SecondFactorAccount,
    secret: StoredTotpSecret,
  ): Promise<void> {
    const id = toUuid(account.id);
    const readWith = account.twoFactor.secret;
    if (!readWith) return Promise.resolve();
    return autocommit(NO_CONSTRAINTS, async () => {
      await this.database
        .updateTable('user_two_factor')
        .set({
          secret_ciphertext: secret.ciphertext,
          secret_iv: secret.iv,
          secret_tag: secret.tag,
        })
        .where('user_id', '=', id)
        .where('secret_ciphertext', '=', readWith.ciphertext)
        .execute();
    });
  }

  clear(account: SecondFactorAccount): Promise<void> {
    const id = toUuid(account.id);
    return this.change(async (work) => {
      await this.replaceCodes(work, id, []);
      await work
        .deleteFrom('user_two_factor')
        .where('user_id', '=', id)
        .execute();
    });
  }

  spendTotpStep(
    account: SecondFactorAccount,
    step: number,
  ): Promise<SpendOutcome> {
    const id = toUuid(account.id);
    const readWith = account.twoFactor.lastUsedStep;
    return autocommit(NO_CONSTRAINTS, async () => {
      const spent = await this.database
        .updateTable('user_two_factor')
        .set({ last_used_step: step })
        .where('user_id', '=', id)
        .where((state) =>
          readWith === null
            ? state('last_used_step', 'is', null)
            : state('last_used_step', '=', readWith),
        )
        .executeTakeFirst();
      return spent.numUpdatedRows === 1n
        ? SPEND_OUTCOME.SPENT
        : SPEND_OUTCOME.ALREADY_SPENT;
    });
  }

  spendRecoveryCode(
    account: SecondFactorAccount,
    hash: string,
    usedAt: Date,
  ): Promise<SpendOutcome> {
    const id = toUuid(account.id);
    return autocommit(NO_CONSTRAINTS, async () => {
      const spent = await this.database
        .updateTable('user_recovery_codes')
        .set({ used_at: usedAt })
        .where('user_id', '=', id)
        .where('hash', '=', hash)
        .where('used_at', 'is', null)
        .executeTakeFirst();
      return spent.numUpdatedRows === 1n
        ? SPEND_OUTCOME.SPENT
        : SPEND_OUTCOME.ALREADY_SPENT;
    });
  }

  reserveAttempt(
    account: SecondFactorAccount,
    attempt: CountedAttempt,
  ): Promise<AttemptReservation> {
    const id = toUuid(account.id);
    return autocommit(NO_CONSTRAINTS, async () => {
      const counted = await this.database
        .updateTable('user_two_factor')
        .set({
          failed_attempts: attempt.failedAttempts,
          locked_until: attempt.lockedUntil,
        })
        .where('user_id', '=', id)
        .where('failed_attempts', '=', account.twoFactor.failedAttempts)
        .executeTakeFirst();
      return counted.numUpdatedRows === 1n
        ? ATTEMPT_RESERVATION.RESERVED
        : ATTEMPT_RESERVATION.REFUSED;
    });
  }

  clearFailedAttempts(account: SecondFactorAccount): Promise<void> {
    const id = toUuid(account.id);
    return autocommit(NO_CONSTRAINTS, async () => {
      await this.database
        .updateTable('user_two_factor')
        .set({ failed_attempts: 0, locked_until: null })
        .where('user_id', '=', id)
        .execute();
    });
  }

  /** One statement, so the state and its codes come from one snapshot. */
  private read(
    userId: string,
    withPassword: boolean,
  ): Promise<SecondFactorAccount | null> {
    return autocommit(NO_CONSTRAINTS, async () => {
      const row = await this.database
        .selectFrom('users')
        .leftJoin('user_two_factor as state', 'state.user_id', 'users.id')
        .select((select) => [
          'users.id',
          'users.email',
          'users.name',
          'users.role',
          'users.permissions',
          'users.auth_provider',
          'users.is_verified',
          'users.is_deleted',
          'users.password_hash',
          'state.enabled',
          'state.secret_ciphertext',
          'state.secret_iv',
          'state.secret_tag',
          'state.confirmed_at',
          'state.last_used_step',
          'state.failed_attempts',
          'state.locked_until',
          jsonArrayFrom(
            select
              .selectFrom('user_recovery_codes as code')
              .select(['code.hash', 'code.used_at'])
              .whereRef('code.user_id', '=', 'users.id')
              .orderBy('code.id'),
          ).as('recovery_codes'),
        ])
        .where('users.id', '=', toUuid(userId))
        .executeTakeFirst();
      if (!row) return null;

      const secret =
        row.secret_ciphertext !== null &&
        row.secret_iv !== null &&
        row.secret_tag !== null
          ? {
              ciphertext: row.secret_ciphertext,
              iv: row.secret_iv,
              tag: row.secret_tag,
            }
          : null;
      const account: SecondFactorAccount = {
        id: row.id,
        email: row.email ?? '',
        isDeleted: row.is_deleted,
        passwordHash: withPassword
          ? (row.password_hash ?? undefined)
          : undefined,
        twoFactor: {
          enabled: row.enabled === true,
          secret,
          confirmedAt: row.confirmed_at,
          // A date inside JSON arrives as text.
          recoveryCodes: row.recovery_codes.map((code) => ({
            hash: code.hash,
            usedAt: code.used_at === null ? null : new Date(code.used_at),
          })),
          lastUsedStep: row.last_used_step,
          failedAttempts: row.failed_attempts ?? 0,
          lockedUntil: row.locked_until,
        },
      };
      return rememberSignInAccount(
        account,
        toSignInAccount(row, row.enabled === true),
      );
    });
  }

  private async replaceCodes(
    work: Transaction<PostgresTables>,
    id: string,
    hashes: string[],
  ): Promise<void> {
    await work
      .deleteFrom('user_recovery_codes')
      .where('user_id', '=', id)
      .execute();
    if (hashes.length === 0) return;
    await work
      .insertInto('user_recovery_codes')
      .values(hashes.map((hash) => ({ user_id: id, hash })))
      .execute();
  }

  private change(
    write: (work: Transaction<PostgresTables>) => Promise<void>,
  ): Promise<void> {
    return autocommit(NO_CONSTRAINTS, () =>
      this.database.transaction().execute(write),
    );
  }
}

/** Issues the session an account is owed once its second factor checked out. */
export class PostgresSecondFactorSignIn extends SecondFactorSignIn {
  constructor(private readonly completion: SignInCompletion) {
    super();
  }

  issueSession(
    account: SecondFactorAccount,
    response: Response,
  ): Promise<AuthenticatedUserSummary> {
    return this.completion.issueSession(signInAccountOf(account), response);
  }
}
