import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { CredentialPurpose } from '../constants/credential-purpose';
import { SECURITY_EVENT_CONSTRAINT } from '../events/security-event.store';
import {
  AccountAuthorityFields,
  ApplicationAuthorityFields,
  GrantAuthorityFields,
  SessionAuthorityFields,
} from '../utils/authority/session-authority-rule';

/** Shared names of the unique rules issuance can run into, on any database. */
export const ISSUANCE_CONSTRAINT = {
  SECURITY_EVENT_ID: SECURITY_EVENT_CONSTRAINT.EVENT_ID,
  SESSION_TOKEN_HASH: 'session.token_hash',
  GRANT_USER_CLIENT: 'grant.user_client',
} as const;

export const ACCOUNT_ISSUANCE_MARK = {
  MARKED: 'marked',
  ACCOUNT_MISSING: 'account_missing',
} as const;

export type AccountIssuanceMark =
  (typeof ACCOUNT_ISSUANCE_MARK)[keyof typeof ACCOUNT_ISSUANCE_MARK];

export interface IssuanceAccount extends AccountAuthorityFields {
  id: string;
}

export interface IssuanceApplication extends ApplicationAuthorityFields {
  clientId: string;
  platform: string;
  allowedScopes: string[];
}

export interface IssuanceGrant extends GrantAuthorityFields {
  id: string;
  clientId: string;
}

export interface NewIssuanceGrant {
  userId: string;
  clientId: string;
  allowedScopes: string[];
}

export interface SessionCapQuery {
  userId: string;
  userVersion: number;
  authEpoch: number;
  now: Date;
  purposes: CredentialPurpose[];
}

/** A session that may count toward the cap, with what its authority rests on. */
export interface SessionCapCandidate {
  session: SessionAuthorityFields;
  application: IssuanceApplication | null;
  grant: IssuanceGrant | null;
}

export interface SessionDeviceLabel {
  type: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  browser?: string;
  os?: string;
  name?: string;
}

/**
 * The label and nothing else a caller's object carries. An adapter stores and
 * hands back this, so a parsed user agent leaves its derived parts behind.
 */
export function deviceLabelOf(device: SessionDeviceLabel): SessionDeviceLabel {
  return {
    type: device.type,
    browser: device.browser,
    os: device.os,
    name: device.name,
  };
}

export interface NewBrowserSession {
  userId: string;
  tokenHash: string;
  csrfToken: string;
  userAgent: string;
  device: SessionDeviceLabel;
  deviceName?: string;
  ip: string;
  clientId: string;
  userVersion: number;
  clientVersion: number;
  grantVersion: number;
  authEpoch: number;
  schemaVersion: number;
  scopes: string[];
  audience: string;
  authenticationMethods: string[];
  credentialPurpose: CredentialPurpose;
  browserGeneration: number;
  authenticatedAt: Date;
  lastUsedAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  idleExpiresAt: Date;
}

export interface IssuanceSecurityEvent {
  targetUserId: string;
  clientId: string;
  sessionId: string;
  action: string;
}

/**
 * What browser sign-in needs stored, and nothing about how.
 *
 * Every method takes part in the sign-in's one atomic workflow, so every method
 * requires the unit of work: none can commit by itself. Every read here is a
 * read inside that unit of work. A committed authority read, the fresh read a
 * validation makes outside any unit of work, is a different kind of method and
 * issuance has none.
 *
 * Ids are opaque strings. A string this database could not have issued is
 * refused with `MalformedIdError` before anything is read.
 *
 * One sign-in per account at a time: once `markAccountIssuance` has returned,
 * no other unit of work can issue for the account, or change its session
 * version, until this one ends. An adapter may take the account earlier, at
 * `readAccountForIssuance`. A second unit of work that reaches a taken account
 * is refused at once with a retryable abort. It does not wait.
 *
 * `findAccount` never takes the account. It serves a unit of work that renews
 * what an earlier sign-in issued, or that takes the account later by another
 * rule, and must not keep a sign-in for the same account out meanwhile.
 */
export abstract class BrowserIssuanceStore {
  /** The account as the unit of work sees it. Takes nothing. */
  abstract findAccount(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<IssuanceAccount | null>;

  abstract readAccountForIssuance(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<IssuanceAccount | null>;

  /** Counts one sign-in on the account and says whether the account was there. */
  abstract markAccountIssuance(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<AccountIssuanceMark>;

  abstract findGrant(
    unitOfWork: UnitOfWork,
    userId: string,
    clientId: string,
  ): Promise<IssuanceGrant | null>;

  /** Stores an allowed grant at version zero that has counted no sign-in. */
  abstract createGrant(
    unitOfWork: UnitOfWork,
    grant: NewIssuanceGrant,
  ): Promise<IssuanceGrant>;

  /** Counts one sign-in on the grant. */
  abstract markGrantIssuance(
    unitOfWork: UnitOfWork,
    grantId: string,
  ): Promise<void>;

  /**
   * Sessions of the account that are stored as live at `now` for the given
   * versions. The caller decides which of them still hold authority.
   */
  abstract listSessionCapCandidates(
    unitOfWork: UnitOfWork,
    query: SessionCapQuery,
  ): Promise<SessionCapCandidate[]>;

  /** Stores a valid, unrevoked browser session and returns its id. */
  abstract insertBrowserSession(
    unitOfWork: UnitOfWork,
    session: NewBrowserSession,
  ): Promise<string>;

  abstract appendSecurityEvent(
    unitOfWork: UnitOfWork,
    event: IssuanceSecurityEvent,
  ): Promise<void>;
}
