import { SecondFactorAccount, StoredTotpSecret } from './second-factor-account';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';

export const SPEND_OUTCOME = {
  SPENT: 'spent',
  ALREADY_SPENT: 'already_spent',
} as const;

/** How a single-use value ended: this call spent it, or it was spent before. */
export type SpendOutcome = (typeof SPEND_OUTCOME)[keyof typeof SPEND_OUTCOME];

export const ATTEMPT_RESERVATION = {
  RESERVED: 'reserved',
  REFUSED: 'refused',
} as const;

/**
 * Whether an answer may be checked: this call counted it, or another answer
 * for the account was counted since the record was read.
 */
export type AttemptReservation =
  (typeof ATTEMPT_RESERVATION)[keyof typeof ATTEMPT_RESERVATION];

/** The count and the lock an answer leaves stored while it is checked. */
export interface CountedAttempt {
  failedAttempts: number;
  lockedUntil: Date | null;
}

export interface SecondFactorConfirmation {
  /** sha256 of each new recovery code, hex encoded. */
  recoveryCodeHashes: string[];
  confirmedAt: Date;
}

/**
 * The second factor state of an account. One database keeps it inside the
 * account and another in rows of their own, so a caller never assumes how many
 * writes a method makes: each method is whole or leaves the account as it was.
 */
export abstract class SecondFactorStore {
  /** Whether this database could have issued the id. */
  abstract isAccountId(id: string): boolean;

  /** The account behind a settings route, deactivated ones included. */
  abstract findAccount(userId: string): Promise<SecondFactorAccount | null>;
  /** The same account with its password hash. */
  abstract findAccountWithPassword(
    userId: string,
  ): Promise<SecondFactorAccount | null>;
  /** The account a sign-in challenge was opened for. */
  abstract findChallengedAccount(
    userId: string,
  ): Promise<SecondFactorAccount | null>;

  /** Stores an unconfirmed secret and drops whatever state was there. */
  abstract savePendingSecret(
    account: SecondFactorAccount,
    secret: StoredTotpSecret,
  ): Promise<void>;
  /** Turns the factor on and replaces every recovery code. */
  abstract saveConfirmation(
    account: SecondFactorAccount,
    confirmation: SecondFactorConfirmation,
  ): Promise<void>;
  /** Confirm the pending secret exactly once inside the caller's transaction. */
  abstract saveConfirmationIn(
    unitOfWork: UnitOfWork,
    account: SecondFactorAccount,
    confirmation: SecondFactorConfirmation,
  ): Promise<boolean>;
  /** Replaces every recovery code, spent or not. */
  abstract replaceRecoveryCodes(
    account: SecondFactorAccount,
    recoveryCodeHashes: string[],
  ): Promise<void>;
  /**
   * Stores `secret` in place of the one this record was read with, only while
   * that one is still stored. A secret that changed since the read is kept.
   */
  abstract replaceSecret(
    account: SecondFactorAccount,
    secret: StoredTotpSecret,
  ): Promise<void>;
  /** Turns the factor off and removes the secret and every recovery code. */
  abstract clear(account: SecondFactorAccount): Promise<void>;

  /**
   * Records `step` as the highest step spent, only while the stored one is
   * still the one this record was read with. Two requests that read the same
   * state cannot both spend.
   */
  abstract spendTotpStep(
    account: SecondFactorAccount,
    step: number,
    unitOfWork?: UnitOfWork,
  ): Promise<SpendOutcome>;
  /**
   * Counts an answer before it is checked: stores `attempt`, only while the
   * stored count is still the one this record was read with. Of two answers
   * that read the same state, one is counted and the other is refused, so the
   * answers checked can never outrun the count.
   * Native attempts also bind the count to the captured account version.
   */
  abstract reserveAttempt(
    account: SecondFactorAccount,
    attempt: CountedAttempt,
    expectedSessionVersion?: number,
  ): Promise<AttemptReservation>;
  /** Clears the count and the lock after a correct answer. */
  abstract clearFailedAttempts(account: SecondFactorAccount): Promise<void>;
  abstract clearFailedAttemptsIn(
    unitOfWork: UnitOfWork,
    account: SecondFactorAccount,
  ): Promise<void>;

  /** Marks the unspent recovery code with this hash as used at `usedAt`. */
  abstract spendRecoveryCode(
    account: SecondFactorAccount,
    hash: string,
    usedAt: Date,
    unitOfWork?: UnitOfWork,
  ): Promise<SpendOutcome>;
}
