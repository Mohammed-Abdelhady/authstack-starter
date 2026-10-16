import { AUTH_SCHEMA_VERSION } from '../../constants/session-policy';
import type { CredentialPurpose } from '../../constants/credential-purpose';
import {
  effectiveSessionDeadlines,
  sessionPastDeadline,
} from '../session/session-deadlines';
import type { EffectiveSessionDeadlines } from '../../types/session-deadlines';

/** The stored session facts the authority rule reads, whatever stores them. */
export interface SessionAuthorityFields {
  isValid: boolean;
  revokedAt?: Date | null;
  proofKeyThumbprint?: string | null;
  credentialPurpose: CredentialPurpose;
  authEpoch: number;
  schemaVersion: number;
  clientId: string;
  userVerified?: boolean;
  policyVersion?: number;
  userVersion: number;
  clientVersion: number;
  grantVersion: number;
  /** How fresh the sign-in is. Lifetimes never count from it. */
  authenticatedAt: Date;
  /** When a mobile session was issued; absent where `authenticatedAt` is that time. */
  issuedAt?: Date | null;
  expiresAt: Date;
  idleExpiresAt: Date;
  lastActivityAt: Date;
}

export interface AccountAuthorityFields {
  isDeleted: boolean;
  sessionVersion: number;
}

export interface ApplicationAuthorityFields {
  platform: string;
  enabled: boolean;
  sessionVersion: number;
  policy: {
    absoluteLifetimeMs: number;
    idleLifetimeMs: number;
    unboundAbsoluteLifetimeMs?: number;
    unboundIdleLifetimeMs?: number;
  };
}

export interface GrantAuthorityFields {
  allowed: boolean;
  sessionVersion: number;
}

export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function currentSessionDeadlines(
  session: SessionAuthorityFields,
  user: AccountAuthorityFields | null | undefined,
  application: ApplicationAuthorityFields | null | undefined,
  grant: GrantAuthorityFields | null | undefined,
  now: Date,
  authEpoch: number,
  purpose: CredentialPurpose,
): EffectiveSessionDeadlines | null {
  if (
    !session.clientId ||
    !isValidDate(session.authenticatedAt) ||
    !isValidDate(session.expiresAt) ||
    !isValidDate(session.idleExpiresAt) ||
    !isValidDate(session.lastActivityAt) ||
    typeof session.userVersion !== 'number' ||
    typeof session.clientVersion !== 'number' ||
    typeof session.grantVersion !== 'number' ||
    typeof session.authEpoch !== 'number' ||
    typeof session.schemaVersion !== 'number'
  ) {
    return null;
  }

  if (
    !session.isValid ||
    session.revokedAt ||
    session.credentialPurpose !== purpose ||
    session.authEpoch !== authEpoch ||
    session.schemaVersion !== AUTH_SCHEMA_VERSION ||
    !user ||
    user.isDeleted ||
    session.userVersion !== (user.sessionVersion ?? 0) ||
    !application ||
    !application.enabled ||
    session.clientVersion !== (application.sessionVersion ?? 0) ||
    !grant ||
    !grant.allowed ||
    session.grantVersion !== (grant.sessionVersion ?? 0)
  ) {
    return null;
  }

  const deadlines = effectiveSessionDeadlines(session, application);
  return sessionPastDeadline(deadlines, now) ? null : deadlines;
}
