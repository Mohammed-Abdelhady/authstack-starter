import { AUTH_SCHEMA_VERSION } from '../../constants/session-policy';
import { CredentialPurpose } from '../../constants/credential-purpose';
import {
  addMs,
  effectiveDeadline,
  isDeadlinePassed,
} from '../session/session-deadline';

/** The stored session facts the authority rule reads, whatever stores them. */
export interface SessionAuthorityFields {
  isValid: boolean;
  revokedAt?: Date | null;
  credentialPurpose: CredentialPurpose;
  authEpoch: number;
  schemaVersion: number;
  clientId: string;
  userVersion: number;
  clientVersion: number;
  grantVersion: number;
  authenticatedAt: Date;
  expiresAt: Date;
  idleExpiresAt: Date;
  lastActivityAt: Date;
}

export interface AccountAuthorityFields {
  isDeleted: boolean;
  sessionVersion: number;
}

export interface ApplicationAuthorityFields {
  enabled: boolean;
  sessionVersion: number;
  policy: { absoluteLifetimeMs: number; idleLifetimeMs: number };
}

export interface GrantAuthorityFields {
  allowed: boolean;
  sessionVersion: number;
}

export interface EffectiveSessionDeadlines {
  absolute: Date;
  idle: Date;
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

  const absolute = effectiveDeadline(
    session.expiresAt,
    addMs(session.authenticatedAt, application.policy.absoluteLifetimeMs),
  );
  const idle = effectiveDeadline(
    session.idleExpiresAt,
    addMs(session.lastActivityAt, application.policy.idleLifetimeMs),
  );
  if (isDeadlinePassed(now, absolute) || isDeadlinePassed(now, idle)) {
    return null;
  }
  return { absolute, idle };
}
