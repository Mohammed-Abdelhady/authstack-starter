import {
  AttemptRule,
  CodeClaim,
  CodeRotation,
} from './pending-registration.store';
import { UnitOfWork } from '../../common/persistence/unit-of-work';

/** Shared names of the unique rules a password reset record can run into. */
export const PASSWORD_RESET_CONSTRAINT = {
  ADDRESS: 'pending_password_reset.email',
} as const;

export interface PasswordResetGeneration {
  hashedCode: string;
  expiresAt: Date;
}

export interface ReservedPasswordResetAttempt {
  id: string;
  hashedCode: string;
}

export interface PasswordResetClaim {
  id: string;
  hashedCode: string;
  now: Date;
}

/**
 * What password reset codes need stored. Each method is one statement that
 * commits by itself: today's reset spends the code before it changes the
 * password, in no transaction.
 *
 * Expiry is compared in `reserveAttempt` and `claimCode`. `rotateCode` is the
 * one method that ignores it on purpose: a new request gives whatever record
 * the address has a new code, expired or not.
 */
export abstract class PasswordResetCodeStore {
  /** Gives the address's record a new code, zero attempts and a new expiry. */
  abstract rotateCode(
    email: string,
    generation: PasswordResetGeneration,
  ): Promise<CodeRotation>;

  /**
   * Stores a record at zero attempts. A record another request stored first is
   * a `UniqueConflictError` named `PASSWORD_RESET_CONSTRAINT.ADDRESS`.
   */
  abstract insertRecord(
    email: string,
    generation: PasswordResetGeneration,
  ): Promise<void>;

  /**
   * Counts one attempt on a live record that is under the cap, then one guess
   * at the address, and returns the record. Null when there is no record, it
   * has expired, it is at the cap, or the address is locked. A guess with no
   * live record is not counted.
   */
  abstract reserveAttempt(
    email: string,
    rule: AttemptRule,
  ): Promise<ReservedPasswordResetAttempt | null>;

  /**
   * Removes exactly the generation that was compared, when it has not expired.
   * Of two callers that claim one generation, one is answered `claimed`, and
   * the address's wrong codes and locks are forgotten.
   */
  abstract claimCode(claim: PasswordResetClaim): Promise<CodeClaim>;

  /** Removes this exact reset generation in the caller's transaction. */
  abstract claimCodeIn(
    unitOfWork: UnitOfWork,
    claim: PasswordResetClaim,
  ): Promise<CodeClaim>;

  /** Removes the address's record when it has expired. */
  abstract dropExpiredRecord(email: string, now: Date): Promise<void>;
}
