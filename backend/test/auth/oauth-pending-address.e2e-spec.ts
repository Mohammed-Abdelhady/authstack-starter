import request from 'supertest';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import type { OAuthProviderStrategy } from '../../src/auth/oauth/oauth-provider.interface';
import { UserRole } from '../../src/user/enums/user-role.enum';
import { SEED_ADMIN } from '../constants/seed-users';
import {
  bootE2eApp,
  browserAgent,
  E2E_CLIENT_URL,
  loginAs,
  type E2eApp,
} from '../utils/e2e-app';
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

  // A live claim must stop provider creation without breaking confirmation.
  it('refuses provider creation on a claimed address and preserves the pending change', async () => {
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
    const code = await e2e.mailedCode();

    const browser = request.agent(e2e.httpServer);
    const started = await browser
      .get('/api/auth/oauth/google/start')
      .redirects(0)
      .expect(302);
    const state = new URL(String(started.headers.location)).searchParams.get(
      'state',
    );
    const callback = await browser
      .get('/api/auth/oauth/google/callback')
      .query({ state, code: 'fixture-code' })
      .redirects(0)
      .expect(302);

    const location = new URL(String(callback.headers.location));
    expect({
      origin: location.origin,
      path: location.pathname,
      query: Object.fromEntries(location.searchParams),
    }).toEqual({
      origin: E2E_CLIENT_URL,
      path: '/auth/oauth/callback',
      query: {
        status: 'error',
        code: ErrorCode.OAUTH_ACCOUNT_EXISTS,
        provider: 'google',
        redirect: '/',
      },
    });
    await browser.get('/api/user/profile').expect(401);
    expect(await e2e.state.accounts.accountIdFor(NEW)).toBeNull();
    expect(await e2e.state.accounts.accountWithId(targetId)).toMatchObject({
      email: OLD,
      pendingEmail: NEW,
      addressGeneration: 1,
      isVerified: true,
    });
    const target = await admin.get(`/api/admin/users/${targetId}`).expect(200);
    expect(target.body).toMatchObject({
      data: {
        email: OLD,
        pendingEmail: NEW,
        linkedProviders: ['email'],
      },
    });

    const confirmation = await browserAgent(e2e.httpServer);
    await confirmation
      .post('/api/auth/confirm-email-change')
      .send({ email: NEW, code })
      .expect(200);
    expect(await e2e.state.accounts.accountIdFor(NEW)).toBe(targetId);
    const confirmed = await e2e.state.accounts.accountWithId(targetId);
    expect(confirmed).toMatchObject({
      email: NEW,
      addressGeneration: 1,
      isVerified: true,
    });
    expect(confirmed?.pendingEmail).toBeUndefined();
  });
});
