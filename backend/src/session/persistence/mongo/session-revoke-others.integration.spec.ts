import { Model, Types } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { SECURITY_EVENT_ACTION } from '../../constants/security-event-action';
import { hashToken } from '../../utils/hashing/token-hash';
import {
  SecurityEvent,
  SecurityEventDocument,
} from './schemas/security-event.schema';
import { startMemoryReplSet } from '../../../../test/utils/memory-replset';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import {
  bootSessionAuthority,
  createTestUser,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  SessionAuthorityHarness,
} from '../../../../test/utils/session-authority-harness';

describe('revoke all other sessions (plan S1)', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: SessionAuthorityHarness;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootSessionAuthority(
      mongo.uri('session_revoke_others'),
      new FrozenClock(TEST_NOW),
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
  });

  async function login(email: string): Promise<{
    userId: Types.ObjectId;
    token: string;
  }> {
    const user = await createTestUser(harness.users, email);
    try {
      const issued = await harness.sessionService.createSession(
        user._id,
        'Mozilla/5.0',
        '127.0.0.1',
      );
      return { userId: user._id, token: issued.sessionToken };
    } catch (error) {
      if (error instanceof AppException) {
        throw new Error(
          `${error.message} ${JSON.stringify(error.getDetails() ?? {})}`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  async function sessionIdFor(token: string): Promise<string> {
    const session = await harness.sessions.findOne({
      tokenHash: hashToken(token),
    });
    if (!session) {
      throw new Error('expected session');
    }
    return session._id.toString();
  }

  it('revokes the current session and leaves others until all-other logout', async () => {
    const first = await login('one@example.test');
    const second = await harness.sessionService.createSession(
      first.userId,
      'second',
      '127.0.0.1',
    );
    const secondToken = second.sessionToken;
    expect(await harness.sessionService.invalidateSession(first.token)).toBe(
      true,
    );
    expect(
      await harness.sessionService.validateSession(first.token),
    ).toBeNull();
    expect(
      await harness.sessionService.validateSession(secondToken),
    ).not.toBeNull();

    const remaining =
      await harness.sessionService.invalidateAllSessionsExceptSession(
        first.userId,
        await sessionIdFor(secondToken),
      );
    expect(remaining).toBe(0);
    expect(
      await harness.sessionService.validateSession(secondToken),
    ).not.toBeNull();
  });

  it('applies concurrent revokes once and keeps the selected session valid', async () => {
    const kept = await login('concurrent-revoke@example.test');
    const targetedTokens = await Promise.all(
      ['target one', 'target two'].map(async (agent) => {
        const issued = await harness.sessionService.createSession(
          kept.userId,
          agent,
          '127.0.0.1',
        );
        return issued.sessionToken;
      }),
    );
    await Promise.allSettled([
      ...targetedTokens.map((token) =>
        harness.sessionService.invalidateSession(token),
      ),
      harness.sessionService.invalidateAllSessionsExceptSession(
        kept.userId,
        await sessionIdFor(kept.token),
      ),
    ]);
    const sessions = await harness.sessions.find({ user: kept.userId }).lean();
    const persisted = [...targetedTokens, kept.token].map((token) => {
      const session = sessions.find(
        (row) => row.tokenHash === hashToken(token),
      );
      return {
        id: session?._id.toString(),
        state: [session?.isValid, Boolean(session?.revokedAt)],
      };
    });
    const events = await harness.app
      .get<Model<SecurityEventDocument>>(getModelToken(SecurityEvent.name))
      .find({
        targetUserId: kept.userId.toString(),
        action: {
          $in: [
            SECURITY_EVENT_ACTION.SESSION_REVOKED,
            SECURITY_EVENT_ACTION.SESSIONS_REVOKED_OTHERS,
          ],
        },
      })
      .lean();
    const expectedEvents = [
      [SECURITY_EVENT_ACTION.SESSION_REVOKED, persisted[0]?.id],
      [SECURITY_EVENT_ACTION.SESSION_REVOKED, persisted[1]?.id],
      [SECURITY_EVENT_ACTION.SESSIONS_REVOKED_OTHERS, persisted[2]?.id],
    ]
      .map(([action, sessionId]) => action + ':' + sessionId)
      .sort();

    expect({
      sessionState: persisted.map(({ state }) => state),
      securityEvents: events
        .map(({ action, sessionId }) => action + ':' + sessionId)
        .sort(),
    }).toEqual({
      sessionState: [
        [false, true],
        [false, true],
        [true, false],
      ],
      securityEvents: expectedEvents,
    });
  });

  it('does not let a revoked caller promote itself during all-other logout', async () => {
    const first = await login('survivor@example.test');
    const otherIssued = await harness.sessionService.createSession(
      first.userId,
      'other',
      '127.0.0.1',
    );
    const other = otherIssued.sessionToken;
    await harness.sessionService.invalidateAllSessionsExceptSession(
      first.userId,
      await sessionIdFor(first.token),
    );
    await expect(
      harness.sessionService.invalidateAllSessionsExceptSession(
        first.userId,
        await sessionIdFor(other),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.SESSION_INVALID });
    expect(
      await harness.sessionService.validateSession(first.token),
    ).not.toBeNull();
    expect(await harness.sessionService.validateSession(other)).toBeNull();
  });
});
