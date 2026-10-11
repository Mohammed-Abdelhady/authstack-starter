import { OAUTH_ERROR as SDK_OAUTH_ERROR } from '@app/sdk';
import { OAUTH_ERROR } from '../../src/session/native/oauth/native-oauth.types';
import { SEED_USER } from '../constants/seed-users';
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

describe('sdk constants', () => {
  it('names the same OAuth failures as the server', () => {
    expect(Object.entries(SDK_OAUTH_ERROR).sort()).toEqual(
      Object.entries(OAUTH_ERROR).sort(),
    );
  });
});

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

    const updated = await client.profile.update({ name: 'Contract User' });
    expect(updated.name).toBe('Contract User');
    expect(updated.id).toBe(profile.id);
    expect((await client.profile.get()).name).toBe('Contract User');
  });

  it('surfaces the field errors of a refused profile update', async () => {
    const client = cookieClient(await loginAs(e2e.httpServer, SEED_USER));

    const error = await apiErrorOf(client.profile.update({ name: 'A' }));

    expect(error.status).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    // The key is the DTO property, not the first word of the message (`Name must be...`).
    expect(Object.keys(required(error.fields, 'field errors'))).toEqual([
      'name',
    ]);
    expect(error.fields?.name).toHaveLength(1);
    expect((await client.profile.get()).name).toBe('Seed User');
  });

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
