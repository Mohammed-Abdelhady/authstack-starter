import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import { startMemoryReplSet } from '../../../../test/utils/memory-replset';
import {
  bootSessionAuthority,
  createTestUser,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  SessionAuthorityHarness,
} from '../../../../test/utils/session-authority-harness';
import {
  SecurityEvent,
  SecurityEventDocument,
} from './schemas/security-event.schema';
import { hashToken } from '../../utils/hashing/token-hash';

const SIX_MINUTES_IN = new Date('2099-01-01T12:06:00.000Z');
/** Six minutes in, plus the seeded web application's thirty idle minutes. */
const EXTENDED_IDLE = new Date('2099-01-01T12:36:00.000Z');
const ADDRESS = 'bridge@example.test';

describe('session services as Mongoose callers see them', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: SessionAuthorityHarness;
  let events: Model<SecurityEventDocument>;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootSessionAuthority(
      mongo.uri('session_service_bridge'),
      new FrozenClock(TEST_NOW),
    );
    events = harness.app.get<Model<SecurityEventDocument>>(
      getModelToken(SecurityEvent.name),
    );
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await harness?.app.close();
    await mongo?.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    harness.clock.set(TEST_NOW);
    await harness.sessions.deleteMany({});
    await harness.grants.deleteMany({});
    await harness.users.deleteMany({});
    await events.deleteMany({});
  });

  async function signedIn(agents: string[]) {
    const user = await createTestUser(harness.users, ADDRESS);
    const tokens: string[] = [];
    for (const agent of agents) {
      const issued = await harness.sessionService.createSession(
        user._id,
        agent,
        '127.0.0.1',
      );
      tokens.push(issued.sessionToken);
    }
    return { userId: user._id, tokens };
  }

  async function storedId(token: string): Promise<Types.ObjectId> {
    const stored = await harness.sessions.findOne({
      tokenHash: hashToken(token),
    });
    if (!stored) {
      throw new Error('expected a stored session');
    }
    return stored._id;
  }

  async function inCallerTransaction(
    work: (
      db: Awaited<ReturnType<typeof harness.connection.startSession>>,
    ) => Promise<void>,
  ): Promise<void> {
    const db = await harness.connection.startSession();
    try {
      await db.withTransaction(() => work(db));
    } finally {
      await db.endSession();
    }
  }

  it('hands a validation back as the session document with its account attached', async () => {
    const { userId, tokens } = await signedIn(['first/1']);
    const sessionId = await storedId(tokens[0]);
    harness.clock.set(SIX_MINUTES_IN);

    const session = await harness.authority.validate(tokens[0]);
    const account = session?.user;

    expect({
      id: session?._id,
      account:
        !account || account instanceof Types.ObjectId
          ? account
          : { id: account._id, email: account.email },
      idleExpiresAt: session?.idleExpiresAt,
      lastActivityAt: session?.lastActivityAt,
      lastUsedAt: session?.lastUsedAt,
      storedIdle: (await harness.sessions.findById(sessionId))?.idleExpiresAt,
    }).toEqual({
      id: sessionId,
      account: { id: userId, email: ADDRESS },
      idleExpiresAt: EXTENDED_IDLE,
      lastActivityAt: SIX_MINUTES_IN,
      lastUsedAt: SIX_MINUTES_IN,
      storedIdle: EXTENDED_IDLE,
    });
  });

  it('lists and looks up sessions as plain documents', async () => {
    const { userId, tokens } = await signedIn(['first/1', 'second/1']);
    const first = await storedId(tokens[0]);
    const second = await storedId(tokens[1]);
    await harness.sessions.updateOne(
      { _id: second },
      { $set: { lastUsedAt: SIX_MINUTES_IN } },
    );

    const listed = await harness.authority.listActive(userId);

    expect({
      listed: listed.map((session) => ({
        id: session._id,
        owner: session.user,
        agent: session.userAgent,
      })),
      byId: (await harness.authority.getById(first.toString()))?._id,
      byToken: (await harness.authority.getByToken(tokens[1]))?._id,
      nativeById: await harness.authority.validateById(first, false),
    }).toEqual({
      listed: [
        { id: second, owner: userId, agent: 'second/1' },
        { id: first, owner: userId, agent: 'first/1' },
      ],
      byId: first,
      byToken: second,
      nativeById: null,
    });
  });

  it("commits a sign-out everywhere with the caller's transaction and not without it", async () => {
    const { userId, tokens } = await signedIn(['first/1']);
    const stop = new Error('the caller changed its mind');

    const aborted = await inCallerTransaction(async (db) => {
      await harness.revocation.revokeAllForUser(userId, db);
      throw stop;
    }).catch((error: unknown) => error);
    const afterAbort = {
      version: (await harness.users.findById(userId))?.sessionVersion,
      events: await events.countDocuments({ action: 'sessions_revoked_all' }),
      validates: (await harness.authority.validate(tokens[0])) !== null,
    };
    let counted = -1;
    await inCallerTransaction(async (db) => {
      counted = await harness.revocation.revokeAllForUser(userId, db, {
        actorId: 'admin-7',
        reasonCode: 'admin_forced',
      });
    });

    expect({
      aborted: aborted === stop,
      afterAbort,
      counted,
      version: (await harness.users.findById(userId))?.sessionVersion,
      event: await events
        .findOne({ action: 'sessions_revoked_all' })
        .then((event) => ({
          actor: event?.actorId,
          reason: event?.reasonCode,
        })),
      validates: (await harness.authority.validate(tokens[0])) !== null,
    }).toEqual({
      aborted: true,
      afterAbort: { version: 0, events: 0, validates: true },
      counted: 1,
      version: 1,
      event: { actor: 'admin-7', reason: 'admin_forced' },
      validates: false,
    });
  });

  it("commits a sign-out everywhere else with the caller's transaction and not without it", async () => {
    const { userId, tokens } = await signedIn(['kept/1', 'other/1']);
    const kept = await storedId(tokens[0]);
    const stop = new Error('the caller changed its mind');

    const aborted = await inCallerTransaction(async (db) => {
      await harness.revocation.revokeAllOthersExceptSession(
        userId,
        kept.toString(),
        db,
      );
      throw stop;
    }).catch((error: unknown) => error);
    const afterAbort = {
      version: (await harness.users.findById(userId))?.sessionVersion,
      keptVersion: (await harness.sessions.findById(kept))?.userVersion,
      events: await events.countDocuments({
        action: 'sessions_revoked_others',
      }),
    };
    let counted = -1;
    await inCallerTransaction(async (db) => {
      counted = await harness.revocation.revokeAllOthersExceptSession(
        userId,
        kept.toString(),
        db,
      );
    });

    expect({
      aborted: aborted === stop,
      afterAbort,
      counted,
      keptVersion: (await harness.sessions.findById(kept))?.userVersion,
      validates: [
        (await harness.authority.validate(tokens[0])) !== null,
        (await harness.authority.validate(tokens[1])) !== null,
      ],
    }).toEqual({
      aborted: true,
      afterAbort: { version: 0, keptVersion: 0, events: 0 },
      counted: 1,
      keptVersion: 1,
      validates: [true, false],
    });
  });
});
