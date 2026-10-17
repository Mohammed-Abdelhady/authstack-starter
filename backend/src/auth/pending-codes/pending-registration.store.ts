import { BoundEmailChangeGeneration } from '../types/prepared-email-change';
import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { EmailChangePurpose, PendingPurpose } from '../constants/registration';
import { CodeGuessRule } from './code-guesses';

/** Shared names of the unique rules a pending code record can run into. */
export const PENDING_REGISTRATION_CONSTRAINT = {
  ADDRESS_PURPOSE: 'pending_registration.email_purpose',
} as const;

export const CODE_ROTATION = {
  ROTATED: 'rotated',
  NO_MATCHING_RECORD: 'no_matching_record',
} as const;

export type CodeRotation = (typeof CODE_ROTATION)[keyof typeof CODE_ROTATION];

export const CODE_CLAIM = {
  CLAIMED: 'claimed',
  NOT_CLAIMABLE: 'not_claimable',
} as const;

export type CodeClaim = (typeof CODE_CLAIM)[keyof typeof CODE_CLAIM];

export const LEGACY_BLOCKER = {
  CLEARED: 'cleared',
  CONFIRMATION_KEPT: 'confirmation_kept',
} as const;

export type LegacyBlocker =
  (typeof LEGACY_BLOCKER)[keyof typeof LEGACY_BLOCKER];

export interface PendingRegistrationKey {
  email: string;
  purpose: PendingPurpose;
}

/** A new code generation for a record, with what an email change binds it to. */
export interface PendingCodeGeneration {
  hashedCode: string;
  expiresAt: Date;
  userId?: string;
  addressGeneration?: number;
}

export interface AttemptRule {
  now: Date;
  maxAttempts: number;
  /** The lock the address and purpose is counted against. */
  guesses: CodeGuessRule;
}

/** The record an attempt was counted on, as it is stored after the count. */
export interface ReservedRegistrationAttempt {
  id: string;
  email: string;
  hashedCode: string;
  userId?: string;
  addressGeneration?: number;
}

export interface RegistrationCodeClaim {
  id: string;
  purpose: PendingPurpose;
  hashedCode: string;
  now: Date;
}

/**
 * What the activation and email-change codes need stored.
 *
 * Expiry is compared in every method that depends on it. No method treats a
 * row that is still stored as live, so a database that never removes expired
 * rows answers the same as one that does.
 *
 * Issuing an email-change code and `claimCode` join the caller's UOW.
 * Other methods commit their statements independently.
 * `claimCode` is part of the workflow that also writes the account, so it
 * requires that workflow's unit of work.
 *
 * Ids are opaque strings. One this database could not have issued is refused
 * with `MalformedIdError` before anything is read.
 */
export abstract class PendingRegistrationStore {
  /**
   * Called after the address claim and current account generation are locked.
   * The record is kept under `purpose`, so a code is only ever confirmed by the
   * route for who asked for the change.
   */
  abstract putEmailChangeCodeIn(
    uow: UnitOfWork,
    email: string,
    generation: BoundEmailChangeGeneration,
    purpose: EmailChangePurpose,
  ): Promise<CodeRotation>;

  /** Gives a record that has not expired a new code and zero attempts. */
  abstract rotateLiveCode(
    key: PendingRegistrationKey,
    now: Date,
    generation: PendingCodeGeneration,
  ): Promise<CodeRotation>;

  /** Gives a record that has expired a new code and zero attempts. */
  abstract replaceExpiredCode(
    key: PendingRegistrationKey,
    now: Date,
    generation: PendingCodeGeneration,
  ): Promise<CodeRotation>;

  /** True when a record is stored, expired or not. */
  abstract hasRecord(key: PendingRegistrationKey): Promise<boolean>;

  /** Removes the record when it has expired. A live one is left alone. */
  abstract dropExpiredRecord(
    key: PendingRegistrationKey,
    now: Date,
  ): Promise<void>;

  /**
   * Stores a record at zero attempts. A record another request stored first is
   * a `UniqueConflictError`.
   */
  abstract insertRecord(
    key: PendingRegistrationKey,
    generation: PendingCodeGeneration,
  ): Promise<void>;

  /**
   * After a refused insert: removes a record from before purposes existed when
   * it is an old sign-up. An old address confirmation is kept and reported, and
   * the caller mails nothing.
   */
  abstract clearLegacyBlocker(email: string): Promise<LegacyBlocker>;

  /**
   * Counts one attempt on a live record that is under the cap, then one guess
   * at the address and purpose, and returns the record. Null when there is no
   * record, it has expired, it is at the cap, or the address is locked. The
   * guess is counted before the code is compared, in one statement, so guesses
   * sent at once cannot pass the limit. A guess with no live record is not
   * counted.
   */
  abstract reserveAttempt(
    key: PendingRegistrationKey,
    rule: AttemptRule,
  ): Promise<ReservedRegistrationAttempt | null>;

  /**
   * Removes exactly the generation that was compared, when it has not expired.
   * Of two units of work that claim one generation, one is answered `claimed`,
   * and its unit of work also forgets the address's wrong codes and locks.
   */
  abstract claimCode(
    unitOfWork: UnitOfWork,
    claim: RegistrationCodeClaim,
  ): Promise<CodeClaim>;
}
