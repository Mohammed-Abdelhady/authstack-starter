import { CREDENTIAL_PURPOSE } from '../../constants/credential-purpose';
import { ENROLMENT_LIFETIME_MS } from '../../constants/enrolment';
import type { EffectiveSessionDeadlines } from '../../types/session-deadlines';
import type {
  ApplicationAuthorityFields,
  SessionAuthorityFields,
} from '../authority/session-authority-rule';
import { addMs, effectiveDeadline, isDeadlinePassed } from './session-deadline';
import { sessionLimitsFor } from './session-limits';

/**
 * Lifetimes count from issue, never from an earlier sign-in a mobile session
 * took over. A missing or unreadable issue time falls back to the sign-in,
 * which is never later, so the lifetime can only get shorter.
 */
function lifetimeStart(session: SessionAuthorityFields): Date {
  const issued = session.issuedAt;
  return issued instanceof Date && Number.isFinite(issued.getTime())
    ? issued
    : session.authenticatedAt;
}

export function effectiveSessionDeadlines(
  session: SessionAuthorityFields,
  application: ApplicationAuthorityFields,
): EffectiveSessionDeadlines {
  if (session.credentialPurpose === CREDENTIAL_PURPOSE.ENROLMENT) {
    const absolute = effectiveDeadline(
      session.expiresAt,
      addMs(lifetimeStart(session), ENROLMENT_LIFETIME_MS),
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
      addMs(lifetimeStart(session), limits.absoluteLifetimeMs),
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
