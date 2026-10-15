import { createHash } from 'node:crypto';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { TEST_NOW } from '../../frozen-clock';
import {
  ADMIN_CLIENT,
  ADMIN_SESSION_CAP,
  HarnessSource,
  rerunAtOnce,
  SESSION_CAP,
  SIGN_IN_ADDRESS,
  signInTimes,
  storedCounts,
  WEB_APPLICATION,
  WEB_CLIENT,
} from './issuance-contract-support';

const ELEVEN_MINUTES_MS = 660_000;
const ONE_MINUTE_MS = 60_000;
const TWO_MINUTES_MS = 120_000;
const CHROME_ON_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0';

/** What a sign-in decides and stores when nothing else is running. */
export function issuanceRuleCases(harness: HarnessSource): void {
  const signIn = (userId: string, clientId = WEB_CLIENT) =>
    harness()
      .service(rerunAtOnce)
      .createBrowserSession(
        userId,
        CHROME_ON_WINDOWS,
        SIGN_IN_ADDRESS,
        clientId,
      );

  it('stores the session, its grant, both counters and the event for a first sign-in', async () => {
    const userId = await harness().seedAccount();

    const issued = await signIn(userId);

    const [session] = await harness().sessions(userId);
    expect({
      session: { ...session, id: typeof session.id },
      grants: (await harness().grants(userId)).map((grant) => ({
        clientId: grant.clientId,
        allowed: grant.allowed,
        issuanceFence: grant.issuanceFence,
      })),
      account: await harness().account(userId),
      events: await harness().events(),
    }).toEqual({
      session: {
        id: 'string',
        tokenHash: createHash('sha256')
          .update(issued.sessionToken)
          .digest('hex'),
        tokenHashBytes: 32,
        csrfToken: issued.csrfToken,
        clientId: 'web',
        isValid: true,
        revoked: false,
        userVersion: 0,
        clientVersion: 0,
        grantVersion: 0,
        authenticationMethods: [],
        userVerified: false,
        policyVersion: 0,
        deviceName: 'Chrome 120 on Windows 10/11',
        device: {
          type: 'desktop',
          browser: 'Chrome 120',
          os: 'Windows 10/11',
          name: 'Chrome 120 on Windows 10/11',
        },
        authenticatedAt: new Date('2099-01-01T12:00:00.000Z'),
        expiresAt: new Date('2099-01-01T14:00:00.000Z'),
        idleExpiresAt: new Date('2099-01-01T12:10:00.000Z'),
      },
      grants: [{ clientId: 'web', allowed: true, issuanceFence: 1 }],
      account: { issuanceFence: 1, sessionVersion: 0 },
      events: [
        {
          action: 'session_issued',
          outcome: 'succeeded',
          targetUserId: userId,
          clientId: 'web',
          sessionId: session.id,
        },
      ],
    });
  });

  it('reuses the grant on the next sign-in and counts it again', async () => {
    const userId = await harness().seedAccount();

    await signIn(userId);
    await signIn(userId);

    expect(await storedCounts(harness(), userId)).toEqual({
      sessions: 2,
      grants: 1,
      grantFences: [2],
      accountFence: 2,
      events: 2,
    });
  });

  it('stamps the session with the versions stored at sign-in', async () => {
    const userId = await harness().seedAccount();
    await harness().seedApplication({
      ...WEB_APPLICATION,
      sessionVersion: 3,
      policyVersion: 9,
    });
    await harness().bumpAccountVersion(userId);

    await signIn(userId);

    const [session] = await harness().sessions(userId);
    expect({
      userVersion: session.userVersion,
      clientVersion: session.clientVersion,
      grantVersion: session.grantVersion,
      userVerified: session.userVerified,
      policyVersion: session.policyVersion,
    }).toEqual({
      userVersion: 1,
      clientVersion: 3,
      grantVersion: 0,
      userVerified: false,
      policyVersion: 9,
    });
  });

  // Failure: trusted method/UV evidence or the current policy snapshot is lost on write.
  it('persists verified evidence through the issuer into storage', async () => {
    const userId = await harness().seedAccount();
    await harness().seedApplication({ ...WEB_APPLICATION, policyVersion: 7 });
    await harness()
      .service(rerunAtOnce)
      .createBrowserSession(
        userId,
        CHROME_ON_WINDOWS,
        SIGN_IN_ADDRESS,
        WEB_CLIENT,
        { authenticationMethods: ['passkey'], userVerified: true },
      );
    const [session] = await harness().sessions(userId);
    expect({
      methods: session.authenticationMethods,
      verified: session.userVerified,
      policy: session.policyVersion,
    }).toEqual({ methods: ['passkey'], verified: true, policy: 7 });
  });

  it.each([
    ['an account that does not exist', 'absent', ErrorCode.USER_NOT_FOUND],
    ['a deleted account', 'deleted', ErrorCode.USER_NOT_FOUND],
  ] as const)('refuses %s and stores nothing', async (_, kind, code) => {
    const userId =
      kind === 'absent'
        ? harness().absentAccountId()
        : await harness().seedAccount({ deleted: true });

    await expect(signIn(userId)).rejects.toMatchObject({ code });

    expect({
      sessions: await harness().sessions(userId),
      grants: await harness().grants(userId),
      events: await harness().events(),
    }).toEqual({ sessions: [], grants: [], events: [] });
  });

  it.each([
    ['an unregistered client', 'unregistered', ErrorCode.APPLICATION_NOT_FOUND],
    ['a disabled client', 'disabled', ErrorCode.APPLICATION_DISABLED],
  ] as const)(
    'refuses %s and leaves the account uncounted',
    async (_, kind, code) => {
      const userId = await harness().seedAccount();
      const clientId = kind === 'unregistered' ? 'nobody' : WEB_CLIENT;
      if (kind === 'disabled') {
        await harness().seedApplication({ ...WEB_APPLICATION, enabled: false });
      }

      await expect(signIn(userId, clientId)).rejects.toMatchObject({ code });

      expect(await storedCounts(harness(), userId)).toEqual({
        sessions: 0,
        grants: 0,
        grantFences: [],
        accountFence: 0,
        events: 0,
      });
    },
  );

  it('refuses an account whose grant is blocked and leaves both counters alone', async () => {
    const userId = await harness().seedAccount();
    await harness().seedBlockedGrant(userId, WEB_CLIENT);

    await expect(signIn(userId)).rejects.toMatchObject({
      code: ErrorCode.GRANT_BLOCKED,
    });

    expect(await storedCounts(harness(), userId)).toEqual({
      sessions: 0,
      grants: 1,
      grantFences: [0],
      accountFence: 0,
      events: 0,
    });
  });

  it('admits the sign-in that fills the cap and refuses the next, leaving state untouched', async () => {
    const userId = await harness().seedAccount();
    await signInTimes(harness().service(rerunAtOnce), userId, SESSION_CAP - 1);

    await signIn(userId);
    const atCap = await storedCounts(harness(), userId);
    await expect(signIn(userId)).rejects.toMatchObject({
      code: ErrorCode.SESSION_LIMIT_REACHED,
    });

    expect({
      atCap,
      afterRefusal: await storedCounts(harness(), userId),
    }).toEqual({
      atCap: {
        sessions: 20,
        grants: 1,
        grantFences: [20],
        accountFence: 20,
        events: 20,
      },
      afterRefusal: {
        sessions: 20,
        grants: 1,
        grantFences: [20],
        accountFence: 20,
        events: 20,
      },
    });
  });

  it('counts only the sessions of the account that is signing in', async () => {
    const fullUser = await harness().seedAccount();
    const otherUser = await harness().seedAccount();
    await signInTimes(harness().service(rerunAtOnce), fullUser, SESSION_CAP);

    await signIn(otherUser);

    expect({
      full: (await harness().sessions(fullUser)).length,
      other: (await harness().sessions(otherUser)).length,
    }).toEqual({ full: 20, other: 1 });
  });

  it('caps admin sessions lower, and a web sign-in is still admitted', async () => {
    const userId = await harness().seedAccount();
    await signInTimes(
      harness().service(rerunAtOnce),
      userId,
      ADMIN_SESSION_CAP,
      ADMIN_CLIENT,
    );

    await expect(signIn(userId, ADMIN_CLIENT)).rejects.toMatchObject({
      code: ErrorCode.SESSION_LIMIT_REACHED,
    });
    await signIn(userId, WEB_CLIENT);

    const sessions = await harness().sessions(userId);
    expect({
      admin: sessions.filter(({ clientId }) => clientId === 'admin').length,
      web: sessions.filter(({ clientId }) => clientId === 'web').length,
    }).toEqual({ admin: 5, web: 1 });
  });

  it.each([
    ['whose idle time has run out', 'expired'],
    ['that was revoked', 'revoked'],
    ['issued before the account version moved', 'outdated'],
    ['issued before its client version moved', 'client-moved'],
    ['issued before its policy version moved', 'policy-moved'],
    ['that outlived a shortened idle policy', 'policy-shortened'],
  ] as const)('does not count a session %s toward the cap', async (_, kind) => {
    const userId = await harness().seedAccount();
    await signInTimes(harness().service(rerunAtOnce), userId, SESSION_CAP);
    if (kind === 'expired') {
      harness().clock.set(new Date(TEST_NOW.getTime() + ELEVEN_MINUTES_MS));
    }
    if (kind === 'revoked') {
      await harness().revokeOneSession(userId);
    }
    if (kind === 'outdated') {
      await harness().bumpAccountVersion(userId);
    }
    if (kind === 'client-moved') {
      await harness().seedApplication({
        ...WEB_APPLICATION,
        sessionVersion: 1,
      });
    }
    if (kind === 'policy-moved') {
      await harness().seedApplication({ ...WEB_APPLICATION, policyVersion: 1 });
    }
    if (kind === 'policy-shortened') {
      await harness().seedApplication({
        ...WEB_APPLICATION,
        idleLifetimeMs: ONE_MINUTE_MS,
      });
      harness().clock.set(new Date(TEST_NOW.getTime() + TWO_MINUTES_MS));
    }

    await signIn(userId);

    expect((await harness().sessions(userId)).length).toBe(21);
  });
}
