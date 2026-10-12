/** A TOTP secret as it is kept: AES-256-GCM, the three parts in base64. */
export interface StoredTotpSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

/** One recovery code. Only its sha256 is kept, hex encoded. */
export interface StoredRecoveryCode {
  readonly hash: string;
  readonly usedAt: Date | null;
}

/** The second factor of an account as it was read. */
export interface SecondFactorState {
  readonly enabled: boolean;
  /** Written by setup. Unconfirmed while `enabled` is false. */
  readonly secret: StoredTotpSecret | null;
  readonly confirmedAt: Date | null;
  /** In the order they were handed out. */
  readonly recoveryCodes: readonly StoredRecoveryCode[];
  /** Highest TOTP step already spent. */
  readonly lastUsedStep: number | null;
  /** Wrong answers since the last correct one. */
  readonly failedAttempts: number;
  /** No answer is checked before this instant. */
  readonly lockedUntil: Date | null;
}

/**
 * An account as the second factor needs it. A write takes the record back, so
 * it lands on the account that was read.
 */
export interface SecondFactorAccount {
  readonly id: string;
  readonly email: string;
  readonly isDeleted: boolean;
  /** Only on a read that asked for it, and only when the account has one. */
  readonly passwordHash?: string;
  readonly twoFactor: SecondFactorState;
}
