import { Kysely, Transaction } from 'kysely';
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
  SpendOutcome,
} from '../../stores/second-factor.store';
import { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { postgresTransactionOf } from '../../../../common/persistence/postgres/postgres-unit-of-work';
import { readPostgresSecondFactorAccount } from './postgres-second-factor-read';
import { confirmSecondFactorIn } from './postgres-second-factor-confirmation';
import {
  spendPostgresTotpStep,
  spendPostgresRecoveryCode,
} from './postgres-second-factor-spending';
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

  async saveConfirmationIn(
    unitOfWork: UnitOfWork,
    account: SecondFactorAccount,
    confirmation: SecondFactorConfirmation,
  ): Promise<boolean> {
    return confirmSecondFactorIn(unitOfWork, account, confirmation);
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
    unitOfWork?: UnitOfWork,
  ): Promise<SpendOutcome> {
    return spendPostgresTotpStep(this.database, account, step, unitOfWork);
  }

  spendRecoveryCode(
    account: SecondFactorAccount,
    hash: string,
    usedAt: Date,
    unitOfWork?: UnitOfWork,
  ): Promise<SpendOutcome> {
    return spendPostgresRecoveryCode(
      this.database,
      account,
      hash,
      usedAt,
      unitOfWork,
    );
  }

  reserveAttempt(
    account: SecondFactorAccount,
    attempt: CountedAttempt,
    expectedSessionVersion?: number,
  ): Promise<AttemptReservation> {
    const id = toUuid(account.id);
    return autocommit(NO_CONSTRAINTS, async () => {
      const reserve = async (
        db: Kysely<PostgresTables> | Transaction<PostgresTables>,
      ) => {
        const counted = await db
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
      };
      if (expectedSessionVersion === undefined) return reserve(this.database);
      return this.database.transaction().execute(async (work) => {
        const owner = await work
          .selectFrom('users')
          .select('session_version')
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (owner?.session_version !== expectedSessionVersion)
          return ATTEMPT_RESERVATION.REFUSED;
        return reserve(work);
      });
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

  async clearFailedAttemptsIn(
    unitOfWork: UnitOfWork,
    account: SecondFactorAccount,
  ): Promise<void> {
    await postgresTransactionOf(unitOfWork)
      .updateTable('user_two_factor')
      .set({ failed_attempts: 0, locked_until: null })
      .where('user_id', '=', toUuid(account.id))
      .execute();
  }

  /** One statement, so the state and its codes come from one snapshot. */
  private read(
    userId: string,
    withPassword: boolean,
  ): Promise<SecondFactorAccount | null> {
    return autocommit(NO_CONSTRAINTS, () =>
      readPostgresSecondFactorAccount(this.database, userId, withPassword),
    );
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
