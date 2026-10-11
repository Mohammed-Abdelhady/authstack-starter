import { SecondFactorAccount, StoredTotpSecret } from './second-factor-account';

export const SPEND_OUTCOME = {
  SPENT: 'spent',
  ALREADY_SPENT: 'already_spent',
} as const;

/** How a single-use value ended: this call spent it, or it was spent before. */
export type SpendOutcome = (typeof SPEND_OUTCOME)[keyof typeof SPEND_OUTCOME];

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
  ): Promise<SpendOutcome>;
  /** Marks the unspent recovery code with this hash as used at `usedAt`. */
  abstract spendRecoveryCode(
    account: SecondFactorAccount,
    hash: string,
    usedAt: Date,
  ): Promise<SpendOutcome>;
}
