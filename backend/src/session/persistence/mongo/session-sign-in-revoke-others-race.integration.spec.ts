import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { SECURITY_EVENT_ACTION } from '../../constants/security-event-action';
import {
  SecurityEvent,
  SecurityEventDocument,
} from './schemas/security-event.schema';
import { ApplicationRegistryService } from './application-registry.service';
import { SecurityEventService } from './security-event.service';
import { SessionIssuanceService } from '../../services/session-issuance.service';
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
import { RaceGate, holdBefore } from '../../../../test/utils/race-gate';

interface SignedInUser {
  userId: Types.ObjectId;
  kept: string;
  keptId: string;
  other: string;
}

describe('sign-in against "sign out everywhere else" race', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: SessionAuthorityHarness;
  let events: Model<SecurityEventDocument>;
  let restores: Array<() => void> = [];
  let gates: RaceGate[] = [];

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootSessionAuthority(
      mongo.uri('sign_in_revoke_others'),
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
    for (const gate of gates) {
      gate.release();
    }
    for (const restore of restores) {
      restore();
    }
    gates = [];
    restores = [];
  });

  function signIn(userId: Types.ObjectId, agent: string) {
    return harness.sessionService.createSession(userId, agent, '127.0.0.1');
  }

  async function twoSessions(email: string): Promise<SignedInUser> {
    const user = await createTestUser(harness.users, email);
    const kept = (await signIn(user._id, 'kept/1')).sessionToken;
    const other = (await signIn(user._id, 'other/1')).sessionToken;
    const keptSession = await harness.sessions.findOne({
      tokenHash: hashToken(kept),
    });
    if (!keptSession) {
      throw new Error('expected the kept session');
    }
    return {
      userId: user._id,
      kept,
      keptId: keptSession._id.toString(),
      other,
    };
  }

  /** The new sign-in has read the account's version and has not written yet. */
  function holdSignInAfterVersionRead(): RaceGate {
    const gate = new RaceGate();
    gates.push(gate);
    restores.push(
      holdBefore(
        harness.app.get(ApplicationRegistryService),
        'requireEnabled',
        (call) => (call === 0 ? gate : undefined),
      ),
    );
    return gate;
  }

  /** The revocation has bumped the version and kept its survivor, uncommitted. */
  function holdRevokeOthersBeforeCommit(): RaceGate {
    const gate = new RaceGate();
    gates.push(gate);
    restores.push(
      holdBefore(harness.app.get(SecurityEventService), 'record', (_, args) =>
        args[0].action === SECURITY_EVENT_ACTION.SESSIONS_REVOKED_OTHERS
          ? gate
          : undefined,
      ),
    );
    return gate;
  }

  async function validates(token: string): Promise<boolean> {
    const session =
      await harness.sessionService.validateSessionWithoutExtendingIdle(token);
    return session !== null;
  }

  async function stored(userId: Types.ObjectId) {
    return {
      sessions: await harness.sessions.countDocuments({ user: userId }),
      issuedEvents: await events.countDocuments({
        action: SECURITY_EVENT_ACTION.SESSION_ISSUED,
      }),
      revokedOthersEvents: await events.countDocuments({
        action: SECURITY_EVENT_ACTION.SESSIONS_REVOKED_OTHERS,
      }),
      userSessionVersion: (await harness.users.findById(userId))
        ?.sessionVersion,
    };
  }

  it('admits the sign-in at the new version when the revocation commits first', async () => {
    const user = await twoSessions('revoke-first@example.test');
    const signInRead = holdSignInAfterVersionRead();
    const revokeWritten = holdRevokeOthersBeforeCommit();

    const signingIn = signIn(user.userId, 'new/1');
    await signInRead.reached(1);
    const revoking = harness.sessionService.invalidateAllSessionsExceptSession(
      user.userId,
      user.keptId,
    );
    await revokeWritten.reached(1);

    revokeWritten.release();
    const revokedCount = await revoking;
    signInRead.release();
    const issued = await signingIn;

    expect({
      revokedCount,
      keptValidates: await validates(user.kept),
      otherValidates: await validates(user.other),
      newValidates: await validates(issued.sessionToken),
      newUserVersion: (
        await harness.sessions.findOne({
          tokenHash: hashToken(issued.sessionToken),
        })
      )?.userVersion,
      ...(await stored(user.userId)),
    }).toEqual({
      revokedCount: 1,
      keptValidates: true,
      otherValidates: false,
      newValidates: true,
      newUserVersion: 1,
      sessions: 3,
      issuedEvents: 3,
      revokedOthersEvents: 1,
      userSessionVersion: 1,
    });
  });

  it('refuses the sign-in whole when it writes under the uncommitted revocation', async () => {
    const user = await twoSessions('sign-in-first@example.test');
    const signInRead = holdSignInAfterVersionRead();
    const revokeWritten = holdRevokeOthersBeforeCommit();

    const signingIn = signIn(user.userId, 'new/1');
    await signInRead.reached(1);
    const revoking = harness.sessionService.invalidateAllSessionsExceptSession(
      user.userId,
      user.keptId,
    );
    await revokeWritten.reached(1);

    signInRead.release();
    await expect(signingIn).rejects.toMatchObject({
      code: ErrorCode.AUTHORITY_UNAVAILABLE,
    });
    const afterRefusal = await stored(user.userId);
    revokeWritten.release();
    const revokedCount = await revoking;

    expect({
      afterRefusal,
      revokedCount,
      keptValidates: await validates(user.kept),
      otherValidates: await validates(user.other),
      issuanceFence: (await harness.users.findById(user.userId))?.issuanceFence,
      ...(await stored(user.userId)),
    }).toEqual({
      afterRefusal: {
        sessions: 2,
        issuedEvents: 2,
        revokedOthersEvents: 0,
        userSessionVersion: 0,
      },
      revokedCount: 1,
      keptValidates: true,
      otherValidates: false,
      issuanceFence: 2,
      sessions: 2,
      issuedEvents: 2,
      revokedOthersEvents: 1,
      userSessionVersion: 1,
    });
  });

  it('refuses the revocation whole while a sign-in holds the account', async () => {
    const user = await twoSessions('sign-in-holds@example.test');
    // Past the account write: the sign-in owns the row until it commits.
    const signInWritten = new RaceGate();
    gates.push(signInWritten);
    restores.push(
      holdBefore(
        harness.app.get(SessionIssuanceService),
        'assertSessionLimit',
        (call) => (call === 0 ? signInWritten : undefined),
      ),
    );

    const signingIn = signIn(user.userId, 'new/1');
    await signInWritten.reached(1);
    await expect(
      harness.sessionService.invalidateAllSessionsExceptSession(
        user.userId,
        user.keptId,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.AUTHORITY_UNAVAILABLE });
    signInWritten.release();
    const issued = await signingIn;

    expect({
      keptValidates: await validates(user.kept),
      otherValidates: await validates(user.other),
      newValidates: await validates(issued.sessionToken),
      keptUserVersion: (await harness.sessions.findById(user.keptId))
        ?.userVersion,
      ...(await stored(user.userId)),
    }).toEqual({
      keptValidates: true,
      otherValidates: true,
      newValidates: true,
      keptUserVersion: 0,
      sessions: 3,
      issuedEvents: 3,
      revokedOthersEvents: 0,
      userSessionVersion: 0,
    });
  });
});
