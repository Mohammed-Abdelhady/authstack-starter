import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import {
  SecurityEvent,
  SecurityEventDocument,
} from './schemas/security-event.schema';
import { hashToken } from '../../utils/hashing/token-hash';
import { startMemoryReplSet } from '../../../../test/utils/memory-replset';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import {
  bootSessionAuthority,
  createTestUser,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  SessionAuthorityHarness,
} from '../../../../test/utils/session-authority-harness';
import {
  REFUSED_EVENT_SEED_ACTION,
  refuseSecurityEvents,
} from '../../../../test/utils/transaction-failure';

describe('a browser session change whose security event is refused', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: SessionAuthorityHarness;
  let events: Model<SecurityEventDocument>;
  let allowEvents: (() => void) | undefined;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootSessionAuthority(
      mongo.uri('browser_event_atomicity'),
      new FrozenClock(TEST_NOW),
    );
    events = harness.app.get<Model<SecurityEventDocument>>(
      getModelToken(SecurityEvent.name),
    );
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (harness) {
      await harness.app.close();
    }
    if (mongo) {
      await mongo.stop();
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    harness.clock.set(TEST_NOW);
    await harness.sessions.deleteMany({});
    await harness.grants.deleteMany({});
    await harness.users.deleteMany({});
    await events.deleteMany({});
  });

  afterEach(() => {
    allowEvents?.();
    allowEvents = undefined;
  });

  async function refuseEvents(): Promise<void> {
    allowEvents = await refuseSecurityEvents(events, TEST_NOW);
  }

  async function signIn(userId: Types.ObjectId, agent: string) {
    const issued = await harness.sessionService.createSession(
      userId,
      agent,
      '127.0.0.1',
    );
    return issued.sessionToken;
  }

  async function validates(token: string): Promise<boolean> {
    const session =
      await harness.sessionService.validateSessionWithoutExtendingIdle(token);
    return session !== null;
  }

  /** Events written by the operation under test, the collision seed aside. */
  function eventsSince(count: number): Promise<number> {
    return events
      .countDocuments({ action: { $ne: REFUSED_EVENT_SEED_ACTION } })
      .then((total) => total - count);
  }

  it('stores no session, grant or fence for a sign-in', async () => {
    const user = await createTestUser(
      harness.users,
      'event-sign-in@example.test',
    );
    await refuseEvents();

    await expect(signIn(user._id, 'refused/1')).rejects.toMatchObject({
      code: ErrorCode.AUTHORITY_UNAVAILABLE,
    });

    expect({
      sessions: await harness.sessions.countDocuments({ user: user._id }),
      grants: await harness.grants.countDocuments({ userId: user._id }),
      issuanceFence: (await harness.users.findById(user._id))?.issuanceFence,
      events: await eventsSince(0),
    }).toEqual({ sessions: 0, grants: 0, issuanceFence: 0, events: 0 });
  });

  it('leaves a session signed in when its sign-out cannot be recorded', async () => {
    const user = await createTestUser(
      harness.users,
      'event-sign-out@example.test',
    );
    const token = await signIn(user._id, 'kept/1');
    await refuseEvents();

    await expect(
      harness.sessionService.invalidateSession(token),
    ).rejects.toMatchObject({ code: ErrorCode.AUTHORITY_UNAVAILABLE });

    const stored = await harness.sessions.findOne({
      tokenHash: hashToken(token),
    });
    expect({
      sessionValid: stored?.isValid,
      revoked: stored?.revokedAt instanceof Date,
      validates: await validates(token),
      events: await eventsSince(1),
    }).toEqual({
      sessionValid: true,
      revoked: false,
      validates: true,
      events: 0,
    });
  });

  it('keeps every session when "sign out everywhere else" cannot be recorded', async () => {
    const user = await createTestUser(
      harness.users,
      'event-others@example.test',
    );
    const current = await signIn(user._id, 'current/1');
    const other = await signIn(user._id, 'other/1');
    const currentSession = await harness.sessions.findOne({
      tokenHash: hashToken(current),
    });
    if (!currentSession) {
      throw new Error('expected the current session');
    }
    await refuseEvents();

    await expect(
      harness.sessionService.invalidateAllSessionsExceptSession(
        user._id,
        currentSession._id.toString(),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.AUTHORITY_UNAVAILABLE });

    expect({
      userSessionVersion: (await harness.users.findById(user._id))
        ?.sessionVersion,
      currentUserVersion: (await harness.sessions.findById(currentSession._id))
        ?.userVersion,
      currentValidates: await validates(current),
      otherValidates: await validates(other),
      events: await eventsSince(2),
    }).toEqual({
      userSessionVersion: 0,
      currentUserVersion: 0,
      currentValidates: true,
      otherValidates: true,
      events: 0,
    });
  });

  it('keeps every session when "sign out everywhere" cannot be recorded', async () => {
    const user = await createTestUser(harness.users, 'event-all@example.test');
    const token = await signIn(user._id, 'all/1');
    await refuseEvents();

    await expect(
      harness.sessionService.invalidateAllSessions(user._id),
    ).rejects.toMatchObject({ code: ErrorCode.AUTHORITY_UNAVAILABLE });

    expect({
      userSessionVersion: (await harness.users.findById(user._id))
        ?.sessionVersion,
      validates: await validates(token),
      events: await eventsSince(1),
    }).toEqual({ userSessionVersion: 0, validates: true, events: 0 });
  });
});
