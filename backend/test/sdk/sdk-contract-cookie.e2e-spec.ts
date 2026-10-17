import { SEED_USER } from '../constants/seed-users';
// feature:email-code:start
import { ConfigService } from '@nestjs/config';
import { lastSignInMail } from '../native/email-code/email-code.fixtures';
import { browserAgent } from '../utils/e2e-app';
import { browserCookieClient } from '../utils/sdk/staff-browser-client';
// feature:email-code:end
import { loginAs } from '../utils/e2e-app';
import { ISSUED_ID_FORM } from '../utils/route-id-answers';
import {
  publicClient,
  apiErrorOf,
  cookieClient,
  required,
} from '../utils/sdk/sdk-transport';
import {
  bootContractApp,
  resetContractApp,
  type E2eApp,
} from '../utils/sdk/sdk-contract.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

function isIsoDate(value: unknown): boolean {
  return typeof value === 'string' && new Date(value).toISOString() === value;
}

const PROFILE_PATH = '/api/user/profile';

const PROFILE_LOCALE = [
  'en',
  'ar', // feature:locale-ar
] as const;
const SELECTED_LOCALE = PROFILE_LOCALE.at(-1) ?? 'en';

describe('sdk contract over a cookie transport', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootContractApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await resetContractApp(e2e);
  });

  it('reads and updates the profile over a cookie session', async () => {
    const client = cookieClient(await loginAs(e2e.httpServer, SEED_USER));

    const profile = await client.profile.get();
    expect(profile).toMatchObject({
      email: 'user@seed.local',
      name: 'Seed User',
      role: 'user',
      locale: 'en',
      authProvider: 'email',
      isVerified: true,
      linkedProviders: ['email'],
    });
    expect(profile.id).toMatch(ISSUED_ID_FORM);
    expect(profile.permissions).toEqual(
      expect.arrayContaining(['profile:read:own', 'profile:update:own']),
    );
    expect(profile.twoFactorEnabled).toBe(false); // feature:totp
    expect(profile.passkeyCount).toBe(0); // feature:passkeys
    expect(isIsoDate(profile.createdAt)).toBe(true);
    expect(isIsoDate(profile.updatedAt)).toBe(true);

    const updated = await client.profile.update({
      name: 'Contract User',
      locale: SELECTED_LOCALE,
      version: required(profile.version, 'observed profile version'),
    });
    expect(updated.version).toBe(
      required(profile.version, 'profile version') + 1,
    );
    expect(updated.name).toBe('Contract User');
    expect(updated.locale).toBe(SELECTED_LOCALE);
    const identity = await client.auth.identity();
    expect(identity.authenticated && identity.user.locale).toBe(
      SELECTED_LOCALE,
    );
    expect(identity.authenticated && identity.user.version).toBe(
      updated.version,
    );
    expect(updated.id).toBe(profile.id);
    expect(await client.profile.get()).toMatchObject({
      name: 'Contract User',
      locale: SELECTED_LOCALE,
      version: updated.version,
    });
  });

  it('refuses stale own-profile writes and keeps the committed winner', async () => {
    const client = cookieClient(await loginAs(e2e.httpServer, SEED_USER));
    const original = await client.profile.get();
    const version = required(original.version, 'observed profile version');
    const saved = await client.profile.update({
      name: 'Committed profile',
      version,
    });
    expect(saved.version).toBe(version + 1);
    const stale = await apiErrorOf(
      client.profile.update({ name: 'Stale profile', version }),
    );
    expect(stale).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(await client.profile.get()).toMatchObject({
      name: 'Committed profile',
      version: version + 1,
    });
  });

  it('commits only one competing own-profile write for an observed version', async () => {
    const client = cookieClient(await loginAs(e2e.httpServer, SEED_USER));
    const version = required(
      (await client.profile.get()).version,
      'profile version',
    );
    const results = await Promise.allSettled([
      client.profile.update({ name: 'First profile', version }),
      client.profile.update({ name: 'Second profile', version }),
    ]);
    const saved = results.filter((result) => result.status === 'fulfilled');
    const refused = results.filter((result) => result.status === 'rejected');
    expect(saved).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      reason: { status: 409, code: 'CONFLICT' },
    });
    if (saved[0]?.status !== 'fulfilled')
      throw new Error('No committed profile');
    const expectedName =
      results[0]?.status === 'fulfilled' ? 'First profile' : 'Second profile';
    expect(saved[0].value).toMatchObject({
      name: expectedName,
      version: version + 1,
    });
    expect(await client.profile.get()).toMatchObject({
      name: expectedName,
      version: version + 1,
    });
  });

  it.each([null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'refuses a malformed supplied own-profile version without changing the account',
    async (version) => {
      const browser = await loginAs(e2e.httpServer, SEED_USER);
      const client = cookieClient(browser);
      const original = await client.profile.get();
      await browser
        .patch(PROFILE_PATH)
        .send({ name: 'Refused profile', version })
        .expect(400);
      expect(await client.profile.get()).toMatchObject({
        name: original.name,
        version: original.version,
      });
    },
  );

  // feature:email-code:start
  it('passes the browser code sign-in summary into a full identity with the stored locale', async () => {
    const existing = cookieClient(await loginAs(e2e.httpServer, SEED_USER));
    await existing.profile.update({ locale: SELECTED_LOCALE });
    await existing.auth.signOut();
    const config = e2e.app.get(ConfigService);
    config.set('emailCode.enabled', true);
    config.set('auth.web.signIn', { emailCode: true, emailLink: false });
    const client = browserCookieClient(await browserAgent(e2e.httpServer));
    expect((await client.auth.methods()).emailCode).toBe(true);
    expect(
      await client.emailCode.request({
        email: ` ${SEED_USER.email.toUpperCase()} `,
        locale: 'en',
      }),
    ).toEqual({ email: SEED_USER.email });
    const mail = await lastSignInMail(e2e, SELECTED_LOCALE);
    const result = await client.emailCode.verify({ code: mail.code });
    expect(result).toMatchObject({
      requiresTwoFactor: false,
      user: { email: SEED_USER.email, authProvider: 'email' },
    });
    expect(result.user).not.toHaveProperty('locale');
    const identity = await client.auth.identity();
    expect(identity.authenticated && identity.user.locale).toBe(
      SELECTED_LOCALE,
    );
    await expect(
      client.emailCode.verify({ code: mail.code }),
    ).rejects.toMatchObject({ code: 'EMAIL_CODE_INVALID' });
  });
  // feature:email-code:end

  it('lists the sessions and revokes one of them', async () => {
    const client = cookieClient(await loginAs(e2e.httpServer, SEED_USER));
    await loginAs(e2e.httpServer, SEED_USER);

    const list = await client.sessions.list();
    expect(list.total).toBe(2);
    expect(list.sessions).toHaveLength(2);
    expect(list.sessions.map((session) => session.isCurrent).sort()).toEqual([
      false,
      true,
    ]);
    for (const session of list.sessions) {
      expect(session.id).toMatch(ISSUED_ID_FORM);
      expect(session.userAgent.length).toBeGreaterThan(0);
      expect(session.ip.length).toBeGreaterThan(0);
      expect(isIsoDate(session.createdAt)).toBe(true);
    }
    const current = required(
      list.sessions.find((session) => session.isCurrent),
      'current session',
    );
    const other = required(
      list.sessions.find((session) => !session.isCurrent),
      'other session',
    );

    const refused = await apiErrorOf(client.sessions.revoke(current.id));
    expect(refused.status).toBe(400);
    expect(refused.code).toBe('CANNOT_REVOKE_CURRENT_SESSION');

    const revoked = await client.sessions.revoke(other.id);
    expect(revoked.message.length).toBeGreaterThan(0);
    const remaining = await client.sessions.list();
    expect(remaining.total).toBe(1);
    expect(remaining.sessions.map((session) => session.id)).toEqual([
      current.id,
    ]);
  });

  it('refuses to revoke the current session whatever the case of its id', async () => {
    const client = cookieClient(await loginAs(e2e.httpServer, SEED_USER));
    const [current] = (await client.sessions.list()).sessions;
    const upper = current.id.toUpperCase();
    // Every other character upper, so the id is neither form the server issues.
    const mixed = [...current.id]
      .map((character, index) =>
        index % 2 === 0 ? character.toUpperCase() : character,
      )
      .join('');
    expect(upper).not.toBe(current.id);
    expect(mixed).not.toBe(current.id);

    for (const sessionId of [upper, mixed]) {
      const refused = await apiErrorOf(client.sessions.revoke(sessionId));
      expect(refused.status).toBe(400);
      expect(refused.code).toBe('CANNOT_REVOKE_CURRENT_SESSION');
    }

    // The session that asked is still signed in.
    const remaining = await client.sessions.list();
    expect(remaining.sessions.map((session) => session.id)).toEqual([
      current.id,
    ]);
  });

  it('revokes every other session and reports how many', async () => {
    const client = cookieClient(await loginAs(e2e.httpServer, SEED_USER));
    await loginAs(e2e.httpServer, SEED_USER);
    await loginAs(e2e.httpServer, SEED_USER);

    expect(await client.sessions.revokeOthers()).toEqual({ revokedCount: 2 });
    expect((await client.sessions.list()).total).toBe(1);
  });

  it('reads the sign-in methods without a session', async () => {
    const methods = await publicClient(e2e).auth.methods();

    // Written by hand: a project that left password sign-in out never offers it.
    const carried: string[] = [
      'password', // feature:email-password
    ];
    expect(methods.password).toBe(carried.includes('password'));
    expect(methods.magicLink).toBe(false);
    expect(methods.twoFactor).toBe(true); // feature:totp
    expect(methods.passkeys).toBe(true); // feature:passkeys
    expect(methods.oauth).toEqual([]);
  });

  it('signs out and the cookie session stops working', async () => {
    const client = cookieClient(await loginAs(e2e.httpServer, SEED_USER));

    const result = await client.auth.signOut();
    expect(result.message.length).toBeGreaterThan(0);

    const error = await apiErrorOf(client.profile.get());
    expect(error.status).toBe(401);
    expect(error.code).toBe('SESSION_REQUIRED');
  });
});
