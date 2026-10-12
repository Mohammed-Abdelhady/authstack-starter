import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { RecordSecurityEventInput } from '../events/security-event-recorder';

export const SESSION_REVOCATION = {
  REVOKED: 'revoked',
  NOT_LIVE: 'not_live',
} as const;

export type SessionRevocationOutcome =
  (typeof SESSION_REVOCATION)[keyof typeof SESSION_REVOCATION];

export const ACCOUNT_VERSION_ADVANCE = {
  ADVANCED: 'advanced',
  VERSION_MOVED: 'version_moved',
} as const;

export type AccountVersionAdvance =
  (typeof ACCOUNT_VERSION_ADVANCE)[keyof typeof ACCOUNT_VERSION_ADVANCE];

export const SURVIVOR_PROMOTION = {
  PROMOTED: 'promoted',
  NOT_LIVE: 'not_live',
} as const;

export type SurvivorPromotion =
  (typeof SURVIVOR_PROMOTION)[keyof typeof SURVIVOR_PROMOTION];

/** The account whose sessions are being ended, as revocation reads it. */
export interface RevocationAccount {
  id: string;
  sessionVersion: number;
}

/** What revocation reads of one session. */
export interface RevocableSession {
  id: string;
  userId: string;
  clientId: string;
  isValid: boolean;
  revoked: boolean;
  userVersion: number;
}

export interface LiveSessionCount {
  userId: string;
  userVersion: number;
  now: Date;
}

export interface SessionRevocationMark {
  at: Date;
  reason: string;
}

/**
 * What ending sessions needs stored, and nothing about how.
 *
 * Every method takes part in one atomic workflow, so every method requires the
 * unit of work: a session's end, the account's version and the security event
 * commit together or not at all. Every read here is a read inside that unit of
 * work.
 *
 * Ids are opaque strings. A string this database could not have issued is
 * refused with `MalformedIdError` before anything is read.
 *
 * One writer per account at a time, shared with sign-in: once
 * `advanceAccountVersion` or `advanceAccountVersionFrom` has returned, no other
 * unit of work can issue for the account or change its session version until
 * this one ends. An adapter may take the account earlier, at
 * `readAccountForRevocation`. The same holds for one session between the read
 * that finds it and the write that ends or promotes it. A second unit of work
 * that reaches a taken account or session is refused at once with a retryable
 * abort. It does not wait.
 */
export abstract class SessionRevocationStore {
  abstract readAccountForRevocation(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<RevocationAccount | null>;

  /** How many of the account's sessions are stored as live at `now`. */
  abstract countLiveSessions(
    unitOfWork: UnitOfWork,
    query: LiveSessionCount,
  ): Promise<number>;

  /** Moves the account's session version on by one, whatever it is. */
  abstract advanceAccountVersion(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<void>;

  /** Moves the version on by one only while it still is `expected`. */
  abstract advanceAccountVersionFrom(
    unitOfWork: UnitOfWork,
    userId: string,
    expected: number,
  ): Promise<AccountVersionAdvance>;

  /** A valid, unrevoked session by the credential that names it. */
  abstract findLiveSessionByTokenHash(
    unitOfWork: UnitOfWork,
    tokenHash: string,
  ): Promise<RevocableSession | null>;

  /** A valid, unrevoked session of this account. */
  abstract findLiveSessionOfAccount(
    unitOfWork: UnitOfWork,
    sessionId: string,
    userId: string,
  ): Promise<RevocableSession | null>;

  /** A session of this account, live or not. */
  abstract findSessionOfAccount(
    unitOfWork: UnitOfWork,
    sessionId: string,
    userId: string,
  ): Promise<RevocableSession | null>;

  /** Ends one session, only while it is still valid and unrevoked. */
  abstract revokeSession(
    unitOfWork: UnitOfWork,
    sessionId: string,
    mark: SessionRevocationMark,
  ): Promise<SessionRevocationOutcome>;

  /**
   * Carries the kept session over to the account's next version, only while it
   * is still valid, unrevoked and at the version it was read at.
   */
  abstract promoteSurvivor(
    unitOfWork: UnitOfWork,
    sessionId: string,
    versions: { from: number; to: number },
  ): Promise<SurvivorPromotion>;

  abstract appendSecurityEvent(
    unitOfWork: UnitOfWork,
    event: RecordSecurityEventInput,
  ): Promise<void>;
}
