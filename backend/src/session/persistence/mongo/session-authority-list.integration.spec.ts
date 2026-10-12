import { Types } from 'mongoose';
import { WEB_CLIENT_ID } from '../../constants/client-ids';
import {
  AUTH_SCHEMA_VERSION,
  MAX_SESSIONS_PER_USER,
  WEB_ABSOLUTE_LIFETIME_MS,
  WEB_IDLE_LIFETIME_MS,
} from '../../constants/session-policy';
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

describe('session authority active-session filtering', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: SessionAuthorityHarness;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootSessionAuthority(
      mongo.uri('session_authority_list'),
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
    await harness.applications.updateMany(
      { clientId: WEB_CLIENT_ID },
      {
        $set: {
          enabled: true,
          sessionVersion: 0,
          'policy.absoluteLifetimeMs': WEB_ABSOLUTE_LIFETIME_MS,
          'policy.idleLifetimeMs': WEB_IDLE_LIFETIME_MS,
        },
      },
    );
  });

  it('finds an ObjectId grant when its user id is queried as a string', async () => {
    const userId = new Types.ObjectId('507f1f77bcf86cd799439301');
    await harness.grants.create({ userId, clientId: WEB_CLIENT_ID });

    const grant = await harness.grants.findOne({
      userId: '507f1f77bcf86cd799439301',
      clientId: WEB_CLIENT_ID,
    });

    expect(grant?.userId.toString()).toBe('507f1f77bcf86cd799439301');
  });

  async function seedAtLimit(email: string): Promise<Types.ObjectId> {
    const user = await createTestUser(harness.users, email);
    const token = (
      await harness.sessionService.createSession(
        user._id,
        'session fixture',
        '127.0.0.1',
      )
    ).sessionToken;
    const original = await harness.sessions.findOne({
      tokenHash: hashToken(token),
    });
    if (!original) {
      throw new Error('expected session');
    }
    const source = original.toObject();
    await harness.sessions.insertMany(
      Array.from({ length: MAX_SESSIONS_PER_USER - 1 }, (_, index) => ({
        ...source,
        _id: new Types.ObjectId(),
        tokenHash:
          'cap-fixture-' + user._id.toString() + '-' + index.toString(),
      })),
    );
    return user._id;
  }

  async function assertInvalidatedSessionsAreIgnored(
    userId: Types.ObjectId,
    invalidate: () => Promise<unknown>,
  ): Promise<void> {
    await invalidate();
    const listedBeforeIssuance =
      await harness.sessionService.getUserSessions(userId);
    const replacementToken = (
      await harness.sessionService.createSession(
        userId,
        'replacement',
        '127.0.0.1',
      )
    ).sessionToken;
    const replacement = await harness.sessions.findOne({
      tokenHash: hashToken(replacementToken),
    });
    const listedAfterIssuance =
      await harness.sessionService.getUserSessions(userId);

    expect({
      before: listedBeforeIssuance.map((session) => session._id.toString()),
      after: listedAfterIssuance.map((session) => session._id.toString()),
      replacementId: replacement?._id.toString(),
    }).toEqual({
      before: [],
      after: [replacement?._id.toString()],
      replacementId: replacement?._id.toString(),
    });
  }

  it('ignores sessions captured before an application version bump', async () => {
    const userId = await seedAtLimit('app-version@example.test');
    await assertInvalidatedSessionsAreIgnored(userId, async () => {
      await harness.applications.updateOne(
        { clientId: WEB_CLIENT_ID },
        { $inc: { sessionVersion: 1 } },
      );
    });
  });

  it('ignores sessions captured before a grant version bump', async () => {
    const userId = await seedAtLimit('grant-version@example.test');
    await assertInvalidatedSessionsAreIgnored(userId, async () => {
      await harness.grants.updateOne(
        { userId, clientId: WEB_CLIENT_ID },
        { $inc: { sessionVersion: 1 } },
      );
    });
  });

  it('ignores sessions captured under an earlier auth epoch', async () => {
    const userId = await seedAtLimit('epoch@example.test');
    await assertInvalidatedSessionsAreIgnored(userId, () =>
      harness.sessions.updateMany({ user: userId }, { $set: { authEpoch: 0 } }),
    );
  });

  it('ignores sessions captured under a different schema version', async () => {
    const userId = await seedAtLimit('schema-version@example.test');
    await assertInvalidatedSessionsAreIgnored(userId, () =>
      harness.sessions.updateMany(
        { user: userId },
        { $set: { schemaVersion: AUTH_SCHEMA_VERSION + 1 } },
      ),
    );
  });

  it('ignores sessions past the current application idle policy', async () => {
    const userId = await seedAtLimit('policy-expiry@example.test');
    await assertInvalidatedSessionsAreIgnored(userId, async () => {
      await harness.applications.updateOne(
        { clientId: WEB_CLIENT_ID },
        { $set: { 'policy.idleLifetimeMs': 1 } },
      );
      harness.clock.advance(2);
    });
  });

  it('treats a missing absolute expiry as an invalid credential', async () => {
    const user = await createTestUser(
      harness.users,
      'missing-expiry@example.test',
    );
    const token = (
      await harness.sessionService.createSession(
        user._id,
        'session fixture',
        '127.0.0.1',
      )
    ).sessionToken;
    await harness.sessions.updateOne(
      { tokenHash: hashToken(token) },
      { $unset: { expiresAt: 1 } },
    );

    expect(
      await harness.authority.validate(token, { extendIdle: false }),
    ).toBeNull();
  });

  it('fails closed when captured authority fields are missing', async () => {
    const user = await createTestUser(harness.users, 'legacy@example.test');
    const token = (
      await harness.sessionService.createSession(
        user._id,
        'session fixture',
        '127.0.0.1',
      )
    ).sessionToken;
    await harness.sessions.updateOne(
      { tokenHash: hashToken(token) },
      { $unset: { clientId: 1, userVersion: 1 } },
    );

    expect(await harness.sessionService.validateSession(token)).toBeNull();
  });

  it('does not extend idle deadlines when listing sessions', async () => {
    const user = await createTestUser(harness.users, 'list@example.test');
    const token = (
      await harness.sessionService.createSession(
        user._id,
        'session fixture',
        '127.0.0.1',
      )
    ).sessionToken;
    const before = await harness.sessions.findOne({
      tokenHash: hashToken(token),
    });
    if (!before) {
      throw new Error('expected session');
    }
    await harness.sessionService.getUserSessions(user._id);
    const after = await harness.sessions.findOne({
      tokenHash: hashToken(token),
    });

    expect({
      idleExpiresAt: after?.idleExpiresAt.getTime(),
      lastActivityAt: after?.lastActivityAt.getTime(),
    }).toEqual({
      idleExpiresAt: before.idleExpiresAt.getTime(),
      lastActivityAt: before.lastActivityAt.getTime(),
    });
  });

  it('rejects a session captured under a different auth epoch', async () => {
    const user = await createTestUser(harness.users, 'old-epoch@example.test');
    const token = (
      await harness.sessionService.createSession(
        user._id,
        'session fixture',
        '127.0.0.1',
      )
    ).sessionToken;
    await harness.sessions.updateOne(
      { tokenHash: hashToken(token) },
      { $set: { authEpoch: 0 } },
    );

    expect(await harness.sessionService.validateSession(token)).toBeNull();
  });
});
