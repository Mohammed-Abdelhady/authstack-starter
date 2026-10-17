import { WEB_CLIENT_ID } from './constants/client-ids';
import {
  WEB_ABSOLUTE_LIFETIME_MS,
  WEB_IDLE_LIFETIME_MS,
} from './constants/session-policy';
import { ApplicationRegistryService } from './persistence/mongo/application-registry.service';
import { SecurityEventService } from './persistence/mongo/security-event.service';
import { hashToken } from './utils/hashing/token-hash';
import { SESSION_LAST_USED_UPDATE_INTERVAL_MS } from '../common/constants/session';
import { startMemoryReplSet } from '../../test/utils/memory-replset';
import { FrozenClock, TEST_NOW } from '../../test/utils/frozen-clock';
import {
  bootSessionAuthority,
  createTestUser,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  SessionAuthorityHarness,
} from '../../test/utils/session-authority-harness';
import { RaceBarrier, holdBefore } from '../../test/utils/race-gate';

describe('idle extension against revocation race', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: SessionAuthorityHarness;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootSessionAuthority(
      mongo.uri('idle_extension_revocation'),
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

  it('does not revive a session whose revocation commits while the extension holds its read', async () => {
    const issued = await login('extension-race@example.test');
    const before = await harness.sessions.findOne({
      tokenHash: hashToken(issued.token),
    });
    if (!before) {
      throw new Error('expected a session');
    }
    // Move past the last-used update interval so the extension really writes.
    harness.clock.set(
      new Date(
        TEST_NOW.getTime() + SESSION_LAST_USED_UPDATE_INTERVAL_MS + 60_000,
      ),
    );

    const applications = harness.app.get(ApplicationRegistryService);
    const events = harness.app.get(SecurityEventService);
    const barrier = new RaceBarrier();
    // The extension has read the session as live and has not written yet.
    const extensionRead = barrier.point('extension-read');
    // The revocation has written inside its transaction and has not committed.
    const revocationWritten = barrier.point('revocation-written');
    const restoreRead = holdBefore(applications, 'findByClientId', (call) =>
      call === 0 ? extensionRead : undefined,
    );
    const restoreEvent = holdBefore(events, 'record', () => revocationWritten);

    let validationAfterRevocation: unknown;
    try {
      const extension = harness.authority.validate(issued.token, {
        extendIdle: true,
      });
      await extensionRead.reached(1);
      const revocation = harness.revocation.revokeByToken(issued.token);
      await revocationWritten.reached(1);

      revocationWritten.release();
      await revocation;
      validationAfterRevocation = await harness.authority.validate(
        issued.token,
        { extendIdle: true },
      );
      extensionRead.release();
      // Accepted boundary: a validation that began before the revocation completed may return its pre-revocation read; the next validation must not.
      await extension;
    } finally {
      extensionRead.release();
      revocationWritten.release();
      restoreRead();
      restoreEvent();
    }

    const after = await harness.sessions.findById(before._id);
    expect({
      validationAfterRevocation,
      sessionValid: after?.isValid,
      revoked: after?.revokedAt instanceof Date,
      idleExpiresAt: after?.idleExpiresAt.getTime(),
      lastActivityAt: after?.lastActivityAt.getTime(),
      laterValidation: await harness.authority.validate(issued.token, {
        extendIdle: false,
      }),
    }).toEqual({
      validationAfterRevocation: null,
      sessionValid: false,
      revoked: true,
      idleExpiresAt: before.idleExpiresAt.getTime(),
      lastActivityAt: before.lastActivityAt.getTime(),
      laterValidation: null,
    });
  });

  it('refuses to extend or validate a session revoked before the validation', async () => {
    const issued = await login('revoked-first@example.test');
    const before = await harness.sessions.findOne({
      tokenHash: hashToken(issued.token),
    });
    if (!before) {
      throw new Error('expected a session');
    }
    harness.clock.set(
      new Date(
        TEST_NOW.getTime() + SESSION_LAST_USED_UPDATE_INTERVAL_MS + 60_000,
      ),
    );

    await harness.revocation.revokeByToken(issued.token);
    const validation = await harness.authority.validate(issued.token, {
      extendIdle: true,
    });
    const after = await harness.sessions.findById(before._id);

    expect({
      validation,
      sessionValid: after?.isValid,
      idleExpiresAt: after?.idleExpiresAt.getTime(),
      lastActivityAt: after?.lastActivityAt.getTime(),
    }).toEqual({
      validation: null,
      sessionValid: false,
      idleExpiresAt: before.idleExpiresAt.getTime(),
      lastActivityAt: before.lastActivityAt.getTime(),
    });
  });

  async function login(email: string): Promise<{ token: string }> {
    const user = await createTestUser(harness.users, email);
    const issued = await harness.sessionService.createSession(
      user._id,
      'Mozilla/5.0',
      '127.0.0.1',
      WEB_CLIENT_ID,
    );
    return { token: issued.sessionToken };
  }
});
