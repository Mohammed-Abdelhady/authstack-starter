import { WEB_CLIENT_ID } from './constants/client-ids';
import {
  WEB_ABSOLUTE_LIFETIME_MS,
  WEB_IDLE_LIFETIME_MS,
} from './constants/session-policy';
import { startMemoryReplSet } from '../../test/utils/memory-replset';
import {
  bootSessionAuthority,
  createTestUser,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  SessionAuthorityHarness,
} from '../../test/utils/session-authority-harness';
import { FrozenClock, TEST_NOW } from '../../test/utils/frozen-clock';
import { holdBefore, RaceGate } from '../../test/utils/race-gate';
import { BrowserIssuanceStore } from './issuance/browser-issuance.store';

describe('session issuance concurrency', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: SessionAuthorityHarness;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootSessionAuthority(
      mongo.uri('session_issuance_concurrency'),
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

  it('issues sessions for 25 different users concurrently', async () => {
    const users = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        createTestUser(harness.users, `parallel-${index}@example.test`),
      ),
    );
    const outcomes = await Promise.allSettled(
      users.map((user) =>
        harness.sessionService.createSession(
          user._id,
          'parallel login',
          '127.0.0.1',
        ),
      ),
    );

    expect({
      fulfilled: outcomes.filter((outcome) => outcome.status === 'fulfilled')
        .length,
      persisted: await harness.sessions.countDocuments({ isValid: true }),
    }).toEqual({ fulfilled: 25, persisted: 25 });
  });

  it('rejects a session committed after a concurrent application disable', async () => {
    const user = await createTestUser(
      harness.users,
      'disable-race@example.test',
    );
    const gate = pauseSignInBeforeItsEvent(
      harness.app.get(BrowserIssuanceStore),
    );
    const issue = harness.sessionService.createSession(
      user._id,
      'disable race',
      '127.0.0.1',
    );
    await gate.reached;

    let applicationWasDisabledAndEnabled = false;
    try {
      await harness.applicationAccess.disableApplication(WEB_CLIENT_ID);
      await harness.applicationAccess.enableApplication(WEB_CLIENT_ID);
      applicationWasDisabledAndEnabled = true;
    } catch {
      applicationWasDisabledAndEnabled = false;
    } finally {
      gate.release();
      gate.restore();
    }

    const outcome = await Promise.allSettled([issue]);
    const token = outcome[0];
    const validation =
      token.status === 'fulfilled'
        ? await harness.authority.validate(token.value.sessionToken, {
            extendIdle: false,
          })
        : undefined;

    expect({
      applicationWasDisabledAndEnabled,
      issued: token.status === 'fulfilled',
      validation,
    }).toEqual({
      applicationWasDisabledAndEnabled: true,
      issued: true,
      validation: null,
    });
  });
});

/**
 * Holds the first sign-in at its last write. By then it has read the
 * application's version and stored its session, and nothing is committed.
 */
function pauseSignInBeforeItsEvent(store: BrowserIssuanceStore) {
  const gate = new RaceGate();
  const restore = holdBefore(store, 'appendSecurityEvent', (call) =>
    call === 0 ? gate : undefined,
  );
  return {
    reached: gate.reached(),
    release: () => gate.release(),
    restore,
  };
}
