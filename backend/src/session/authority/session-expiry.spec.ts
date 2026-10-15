import type {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../common/persistence/unit-of-work';
import type { Clock } from '../../common/services/clock';
import { partialMock } from '../../common/testing/test-doubles.harness-spec';
import { WEB_CLIENT_ID } from '../constants/client-ids';
import { CREDENTIAL_PURPOSE } from '../constants/credential-purpose';
import { REVOKED_REASON } from '../constants/revoked-reason';
import { SECURITY_EVENT_ACTION } from '../constants/security-event-action';
import type { EnrolmentStore } from '../enrolment/enrolment.store';
import type { RecordSecurityEventInput } from '../events/security-event-recorder';
import type { IssuanceApplication } from '../issuance/browser-issuance.store';
import type { IssuanceApplications } from '../issuance/issuance-applications';
import {
  SESSION_REVOCATION,
  type SessionRevocationMark,
  type SessionRevocationStore,
} from '../revocation/session-revocation.store';
import type { StoredSession } from './session-authority.store';
import { SessionExpiry } from './session-expiry';

const NOW = new Date('2099-01-01T12:00:00.000Z');
const SESSION_ID = 'expiring-session';
const USER_ID = 'expiring-user';
const APPLICATION: IssuanceApplication = {
  clientId: WEB_CLIENT_ID,
  platform: 'web',
  enabled: true,
  sessionVersion: 0,
  allowedScopes: ['api'],
  policy: { absoluteLifetimeMs: 604_800_000, idleLifetimeMs: 1_800_000 },
};

function storedSession(lastActivityAt: string, idleExpiresAt: string) {
  const session: StoredSession = {
    id: SESSION_ID,
    userId: USER_ID,
    userAgent: 'Expiry/1',
    ip: '127.0.0.1',
    authenticationMethods: ['password'],
    userVerified: false,
    policyVersion: 0,
    createdAt: new Date('2099-01-01T08:00:00.000Z'),
    isValid: true,
    revokedAt: null,
    credentialPurpose: CREDENTIAL_PURPOSE.BROWSER_SESSION,
    authEpoch: 0,
    schemaVersion: 1,
    clientId: WEB_CLIENT_ID,
    userVersion: 0,
    clientVersion: 0,
    grantVersion: 0,
    authenticatedAt: new Date('2099-01-01T08:00:00.000Z'),
    expiresAt: new Date('2099-01-08T08:00:00.000Z'),
    lastActivityAt: new Date(lastActivityAt),
    idleExpiresAt: new Date(idleExpiresAt),
  };
  return session;
}

const IDLE_EXPIRED = storedSession(
  '2099-01-01T11:00:00.000Z',
  '2099-01-01T11:30:00.000Z',
);
const EXTENDED = storedSession(
  '2099-01-01T11:59:00.000Z',
  '2099-01-01T12:29:00.000Z',
);

/**
 * One pooled connection: the unit of work holds it, so every read must go
 * through that unit of work. The row read before the lock is `beforeLock`.
 */
function expiryOverOneConnection(
  beforeLock: StoredSession,
  underLock: StoredSession,
) {
  const held = { open: false, work: partialMock<UnitOfWork>() };
  const runner = partialMock<UnitOfWorkRunner>({
    run: async (work) => {
      if (held.open) throw new Error('No pooled connection is free');
      held.open = true;
      try {
        return await work(held.work);
      } finally {
        held.open = false;
      }
    },
  });
  const own = (work: UnitOfWork): void => {
    if (!held.open || work !== held.work) {
      throw new Error(
        'Read outside the unit of work that holds the connection',
      );
    }
  };
  let locked = false;
  const revoked: SessionRevocationMark[] = [];
  const events: RecordSecurityEventInput[] = [];
  const revocations = partialMock<SessionRevocationStore>({
    readAccountForRevocation: (work, userId) => {
      own(work);
      return Promise.resolve({ id: userId, sessionVersion: 0 });
    },
    findSessionOfAccount: (work, sessionId, userId) => {
      own(work);
      locked = true;
      return Promise.resolve({
        id: sessionId,
        userId,
        clientId: WEB_CLIENT_ID,
        isValid: true,
        revoked: false,
        userVersion: 0,
      });
    },
    revokeSession: (work, _sessionId, mark) => {
      own(work);
      revoked.push(mark);
      return Promise.resolve(SESSION_REVOCATION.REVOKED);
    },
    appendSecurityEvent: (work, event) => {
      own(work);
      events.push(event);
      return Promise.resolve();
    },
  });
  const sessions = partialMock<EnrolmentStore>({
    readSessionIn: (work) => {
      own(work);
      return Promise.resolve(locked ? underLock : beforeLock);
    },
  });
  const applications = partialMock<IssuanceApplications>({
    requireEnabled: (work) => {
      own(work);
      return Promise.resolve(APPLICATION);
    },
  });
  const clock = partialMock<Clock>({ now: () => NOW });
  const expiry = new SessionExpiry(
    runner,
    sessions,
    applications,
    revocations,
    clock,
  );
  return { expiry, revoked, events };
}

// Failure: expiry waits for a second pooled connection while it holds the
// first, or reads its deadlines before the lock and ends a session that a
// concurrent idle extension kept alive.
describe('session expiry', () => {
  it('ends a session past its idle deadline inside the unit of work it holds', async () => {
    const { expiry, revoked, events } = expiryOverOneConnection(
      IDLE_EXPIRED,
      IDLE_EXPIRED,
    );

    await expiry.expireIfStillPastLimit(SESSION_ID, USER_ID);

    expect({ revoked, events }).toEqual({
      revoked: [{ at: NOW, reason: REVOKED_REASON.EXPIRED }],
      events: [
        {
          action: SECURITY_EVENT_ACTION.SESSION_REVOKED,
          reasonCode: REVOKED_REASON.EXPIRED,
          targetUserId: USER_ID,
          clientId: WEB_CLIENT_ID,
          sessionId: SESSION_ID,
        },
      ],
    });
  });

  it('keeps a session whose idle extension committed before the lock', async () => {
    const { expiry, revoked, events } = expiryOverOneConnection(
      IDLE_EXPIRED,
      EXTENDED,
    );

    await expiry.expireIfStillPastLimit(SESSION_ID, USER_ID);

    expect({ revoked, events }).toEqual({ revoked: [], events: [] });
  });
});
