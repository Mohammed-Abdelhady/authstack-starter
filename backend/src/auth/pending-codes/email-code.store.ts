import { UnitOfWork } from '../../common/persistence/unit-of-work';

/** Fixed when a code is made. A code is accepted only where its purpose is asked for. */
export const EMAIL_CODE_PURPOSE = {
  SIGN_IN: 'sign-in',
} as const;

export type EmailCodePurpose =
  (typeof EMAIL_CODE_PURPOSE)[keyof typeof EMAIL_CODE_PURPOSE];

/** A stored purpose read back. One this build does not know is a fault, never a guess. */
export function storedEmailCodePurpose(value: string): EmailCodePurpose {
  const purpose = Object.values(EMAIL_CODE_PURPOSE).find(
    (known) => known === value,
  );
  if (!purpose) throw new Error(`Unknown email code purpose: ${value}`);
  return purpose;
}

/** The wrong guess that reaches this count spends the owner's code. */
export const EMAIL_CODE_GUESS_LIMIT = 5;

/** One code per owner and purpose. The owner is an attempt, never an address. */
export interface EmailCodeKey {
  ownerId: string;
  purpose: EmailCodePurpose;
}

export interface NewEmailCode extends EmailCodeKey {
  email: string;
  codeHash: string;
  expiresAt: Date;
  /** Stored already spent: the code was never mailed and must never match. */
  spent: boolean;
}

export interface StoredEmailCode extends EmailCodeKey {
  email: string;
  codeHash: string;
  wrongGuesses: number;
  expiresAt: Date;
  spentAt: Date | null;
}

/**
 * Codes are judged by `expiresAt`, never by whether their row is still there.
 * Wrong guesses belong to the owner, so replacing its code keeps them.
 */
export abstract class EmailCodeStore {
  /** Stores the owner's code for the purpose, replacing the one before it. */
  abstract put(code: NewEmailCode): Promise<StoredEmailCode>;

  abstract find(key: EmailCodeKey): Promise<StoredEmailCode | null>;

  /**
   * Counts one wrong guess and returns the new count. The guess that reaches
   * `limit` spends the code. Null when the owner has no code.
   */
  abstract recordWrongGuess(
    key: EmailCodeKey,
    limit: number,
  ): Promise<number | null>;

  /**
   * Spends exactly this code while it is unspent, unexpired and under `limit`.
   * False when another call spent it first, it was replaced, or it ran out.
   */
  abstract spendIn(
    unitOfWork: UnitOfWork,
    key: EmailCodeKey,
    code: { codeHash: string; limit: number },
  ): Promise<boolean>;
}
