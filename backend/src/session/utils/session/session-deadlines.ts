import { CREDENTIAL_PURPOSE } from '../../constants/credential-purpose';
import { ENROLMENT_LIFETIME_MS } from '../../constants/enrolment';
import type { EffectiveSessionDeadlines } from '../../types/session-deadlines';
import type {
  ApplicationAuthorityFields,
  SessionAuthorityFields,
} from '../authority/session-authority-rule';
import { addMs, effectiveDeadline, isDeadlinePassed } from './session-deadline';
import { sessionLimitsFor } from './session-limits';

export function effectiveSessionDeadlines(
  session: SessionAuthorityFields,
  application: ApplicationAuthorityFields,
): EffectiveSessionDeadlines {
  if (session.credentialPurpose === CREDENTIAL_PURPOSE.ENROLMENT) {
    const absolute = effectiveDeadline(
      session.expiresAt,
      addMs(session.authenticatedAt, ENROLMENT_LIFETIME_MS),
    );
    return {
      absolute,
      idle: effectiveDeadline(session.idleExpiresAt, absolute),
    };
  }
  const limits = sessionLimitsFor(
    application,
    Boolean(session.proofKeyThumbprint),
  );
  return {
    absolute: effectiveDeadline(
      session.expiresAt,
      addMs(session.authenticatedAt, limits.absoluteLifetimeMs),
    ),
    idle: effectiveDeadline(
      session.idleExpiresAt,
      addMs(session.lastActivityAt, limits.idleLifetimeMs),
    ),
  };
}

export function sessionPastDeadline(
  deadlines: EffectiveSessionDeadlines,
  now: Date,
): boolean {
  return (
    isDeadlinePassed(now, deadlines.absolute) ||
    isDeadlinePassed(now, deadlines.idle)
  );
}
