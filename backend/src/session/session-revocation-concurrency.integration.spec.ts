import { WEB_CLIENT_ID } from './constants/client-ids';
import {
  WEB_ABSOLUTE_LIFETIME_MS,
  WEB_IDLE_LIFETIME_MS,
} from './constants/session-policy';
import {
  IssuedBrowserSession,
  SessionIssuanceService,
} from './services/session-issuance.service';
import { hashToken } from './utils/hashing/token-hash';
import { startMemoryReplSet } from '../../test/utils/memory-replset';
import { FrozenClock, TEST_NOW } from '../../test/utils/frozen-clock';
import {
  bootSessionAuthority,
  createTestUser,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  SessionAuthorityHarness,
} from '../../test/utils/session-authority-harness';
import { RaceBarrier } from '../../test/utils/race-gate';

describe('browser sign-in against revoke-all race', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: SessionAuthorityHarness;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootSessionAuthority(
      mongo.uri('revoke_all_race'),
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
      { clientId: WEB_CLIENT_ID, environment: 'test' },
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

  it('invalidates a sign-in that commits while the revoke-all is waiting', async () => {
    const user = await createTestUser(
      harness.users,
      'revoke-race@example.test',
    );
    const issuance = harness.app.get(SessionIssuanceService);
    const assertSessionLimit = issuance.assertSessionLimit.bind(issuance);
    const barrier = new RaceBarrier();
    const limit = barrier.point('session-limit');
    const spy = jest
      .spyOn(issuance, 'assertSessionLimit')
      .mockImplementation(async (session, checkedUser, application, now) => {
        await limit.hold();
        return assertSessionLimit(session, checkedUser, application, now);
      });

    let issued: IssuedBrowserSession | undefined;
    try {
      const signIn = harness.sessionService.createSession(
        user._id,
        'race/1',
        '127.0.0.1',
      );
      await limit.reached(1);
      const revokeAll = harness.revocation.revokeAllForUser(user._id);
      limit.release();
      issued = await signIn;
      await revokeAll;
    } finally {
      limit.release();
      spy.mockRestore();
    }
    if (!issued) {
      throw new Error('sign-in race did not run');
    }

    const stored = await harness.sessions.findOne({
      tokenHash: hashToken(issued.sessionToken),
    });
    const storedUser = await harness.users.findById(user._id);

    expect({
      validation: await harness.sessionService.validateSession(
        issued.sessionToken,
      ),
      sessionUserVersion: stored?.userVersion,
      userSessionVersion: storedUser?.sessionVersion,
    }).toEqual({
      validation: null,
      sessionUserVersion: 0,
      userSessionVersion: 1,
    });
  });

  it('accepts a sign-in that starts after the revoke-all commits', async () => {
    const user = await createTestUser(
      harness.users,
      'after-revoke@example.test',
    );
    await harness.revocation.revokeAllForUser(user._id);

    const issued = await harness.sessionService.createSession(
      user._id,
      'after/1',
      '127.0.0.1',
    );
    const stored = await harness.sessions.findOne({
      tokenHash: hashToken(issued.sessionToken),
    });
    const storedUser = await harness.users.findById(user._id);

    expect({
      sessionUserVersion: stored?.userVersion,
      userSessionVersion: storedUser?.sessionVersion,
    }).toEqual({ sessionUserVersion: 1, userSessionVersion: 1 });
    expect(
      await harness.sessionService.validateSession(issued.sessionToken),
    ).not.toBeNull();
  });
});
