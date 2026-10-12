import request from 'supertest';
import type { OAuthProviderStrategy } from '../../src/auth/oauth/oauth-provider.interface';
import { UserRole } from '../../src/user/enums/user-role.enum';
import { SEED_ADMIN } from '../constants/seed-users';
import type { ApiBody, UserResponse } from '../types/e2e-responses';
import { bootE2eApp, loginAs, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const OLD = 'holder@example.test';
const NEW = 'stranger@example.test';

/** A provider that vouches for the address the account only waits for. */
const PROVIDER: OAuthProviderStrategy = {
  id: 'google',
  displayName: 'Google',
  envPrefix: 'OAUTH_GOOGLE',
  supportsPkce: true,
  usesOidc: false,
  emailAlwaysVerified: true,
  autoLinksByEmail: true,
  callbackMethod: 'GET',
  isEnabled: () => true,
  getAuthorizationUrl: ({ state }) =>
    `https://provider.example/authorize?state=${encodeURIComponent(state)}`,
  exchangeCode: () => Promise.resolve({ accessToken: 'fixture-token' }),
  fetchProfile: () =>
    Promise.resolve({
      providerId: 'provider-stranger',
      email: NEW,
      emailVerified: true,
      name: 'Stranger',
    }),
};

describe('provider sign-in for an address an account waits to confirm (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp(0, { browserStrategy: PROVIDER });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  it('opens a separate account and links nothing to the waiting one', async () => {
    const { _id: targetId } = await e2e.state.accounts.createAccount({
      email: OLD,
      name: 'Account Holder',
      role: UserRole.SUPPORT,
      isVerified: true,
      addressGeneration: 0,
    });
    const admin = await loginAs(e2e.httpServer, SEED_ADMIN);
    await admin
      .patch(`/api/admin/users/${targetId}`)
      .send({ email: NEW })
      .expect(200);

    const browser = request.agent(e2e.httpServer);
    const started = await browser
      .get('/api/auth/oauth/google/start')
      .redirects(0)
      .expect(302);
    const state = new URL(String(started.headers.location)).searchParams.get(
      'state',
    );
    await browser
      .get('/api/auth/oauth/google/callback')
      .query({ state, code: 'fixture-code' })
      .redirects(0)
      .expect(302);

    const profile = await browser.get('/api/user/profile').expect(200);
    const signedIn = (profile.body as ApiBody<UserResponse>).data;
    expect(signedIn.id).not.toBe(targetId);
    expect([signedIn.email, signedIn.role]).toEqual([NEW, UserRole.USER]);
    const target = await admin.get(`/api/admin/users/${targetId}`).expect(200);
    expect(target.body).toMatchObject({
      data: { email: OLD, linkedProviders: ['email'] },
    });
  });
});
