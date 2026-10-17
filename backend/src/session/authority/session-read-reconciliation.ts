import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { AUTH_SCHEMA_VERSION } from '../constants/session-policy';
import type { CredentialPurpose } from '../constants/credential-purpose';
import { isValidDate } from '../utils/authority/session-authority-rule';
import type {
  AuthorityAccount,
  StoredSession,
} from './session-authority.store';

interface SessionRead {
  session: StoredSession;
  account: AuthorityAccount;
  readSession: () => Promise<StoredSession | null>;
  purpose: CredentialPurpose;
  authEpoch: () => number;
}

export function hasSessionReadAuthority(
  session: StoredSession,
  purpose: CredentialPurpose,
  authEpoch: number,
): boolean {
  return (
    hasRequiredAuthorityFields(session) &&
    session.isValid &&
    !session.revokedAt &&
    session.credentialPurpose === purpose &&
    session.authEpoch === authEpoch &&
    session.schemaVersion === AUTH_SCHEMA_VERSION
  );
}

export async function reconcileSessionRead(
  input: SessionRead,
): Promise<StoredSession | null> {
  const { session, account } = input;
  if (session.userVersion === account.sessionVersion) return session;
  if (!(session.userVersion < account.sessionVersion)) return null;
  const current = await input.readSession();
  if (
    !current ||
    !sameCredential(session, current) ||
    !hasSessionReadAuthority(current, input.purpose, input.authEpoch())
  ) {
    return null;
  }
  if (current.userVersion > account.sessionVersion) {
    throw new AppException(
      ErrorCode.AUTHORITY_UNAVAILABLE,
      'Authentication authority changed during validation',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  return current.userVersion === account.sessionVersion ? current : null;
}

function sameCredential(
  initial: StoredSession,
  current: StoredSession,
): boolean {
  return (
    initial.id === current.id &&
    initial.userId === current.userId &&
    initial.clientId === current.clientId &&
    initial.credentialPurpose === current.credentialPurpose
  );
}

function hasRequiredAuthorityFields(session: StoredSession): boolean {
  return Boolean(
    session.clientId &&
    isValidDate(session.authenticatedAt) &&
    isValidDate(session.expiresAt) &&
    isValidDate(session.idleExpiresAt) &&
    isValidDate(session.lastActivityAt) &&
    typeof session.userVersion === 'number' &&
    typeof session.clientVersion === 'number' &&
    typeof session.grantVersion === 'number' &&
    typeof session.authEpoch === 'number' &&
    typeof session.schemaVersion === 'number',
  );
}
