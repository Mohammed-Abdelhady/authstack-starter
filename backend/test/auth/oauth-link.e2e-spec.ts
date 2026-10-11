import { ErrorCode } from '../../src/common/enums/error-code.enum';
import type { OAuthProviderStrategy } from '../../src/auth/oauth/oauth-provider.interface';
import { SEED_USER } from '../constants/seed-users';
import { bootE2eApp, loginAs, type E2eApp } from '../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { TEST_NOW } from '../utils/frozen-clock';

const GOOGLE_STRATEGY: OAuthProviderStrategy = {
  id: 'google',
  displayName: 'Google',
  envPrefix: 'OAUTH_GOOGLE',
  supportsPkce: true,
  usesOidc: false,
  emailAlwaysVerified: true,
  callbackMethod: 'GET',
  isEnabled: () => true,
  getAuthorizationUrl: () => 'https://provider.example/authorize',
  exchangeCode: () => Promise.reject(new Error('unused in this spec')),
  fetchProfile: () => Promise.reject(new Error('unused in this spec')),
};

describe('provider link start with both credentials (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp(0, { browserStrategy: GOOGLE_STRATEGY });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  it('refuses a link start carrying both a cookie and a bearer token', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);

    const mixed = await browser
      .get('/api/auth/oauth/google/start')
      .query({ intent: 'link' })
      .set('Authorization', 'Bearer native-token')
      .redirects(0);

    expect(mixed.status).toBe(302);
    const location = new URL(String(mixed.headers.location));
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('code')).toBe(ErrorCode.MIXED_CREDENTIALS);
    expect(location.searchParams.get('provider')).toBe('google');
  });

  it('starts a link with the cookie alone', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);

    const started = await browser
      .get('/api/auth/oauth/google/start')
      .query({ intent: 'link' })
      .redirects(0);

    expect(started.status).toBe(302);
    expect(String(started.headers.location)).toBe(
      'https://provider.example/authorize',
    );
  });

  // feature:email-password,magic-link:start
  it('lists the sign-in methods with what an unlink of each would be told', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    await e2e.state.auth.linkProviderAccounts(SEED_USER.email, [
      { provider: 'google', providerId: 'google-1', linkedAt: TEST_NOW },
    ]);

    const listed = await browser.get('/api/user/linked-providers').expect(200);

    // Password sign-in is on, so the address still signs in without Google.
    expect(listed.body).toMatchObject({
      data: {
        providers: ['email', 'google'],
        unlinkHints: { email: 'not_removable', google: 'allowed' },
      },
    });
    await browser.delete('/api/user/unlink-provider/google').expect(200);
    const after = await browser.get('/api/user/linked-providers').expect(200);
    expect(after.body).toMatchObject({
      data: { providers: ['email'], unlinkHints: { email: 'not_removable' } },
    });
  });
  // feature:email-password,magic-link:end

  it('lists which sign-in methods can be primary and answers each choice the same way', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    await e2e.state.auth.linkProviderAccounts(SEED_USER.email, [
      { provider: 'google', providerId: 'google-1', linkedAt: TEST_NOW },
    ]);

    const listed = await browser.get('/api/user/linked-providers').expect(200);

    expect(listed.body).toMatchObject({
      data: {
        providers: ['email', 'google'],
        primaryHints: { email: 'no_profile_to_sync', google: 'allowed' },
      },
    });
    const refused = await browser
      .post('/api/user/set-primary-provider')
      .send({ provider: 'email' })
      .expect(400);
    expect(refused.body).toMatchObject({
      error: { code: ErrorCode.VALIDATION_ERROR },
    });
    await browser
      .post('/api/user/set-primary-provider')
      .send({ provider: 'google' })
      .expect(200);
    const after = await browser.get('/api/user/linked-providers').expect(200);
    expect(after.body).toMatchObject({
      data: {
        primaryProvider: 'google',
        primaryHints: { email: 'no_profile_to_sync', google: 'allowed' },
      },
    });
  });

  it('says whether email sign-in is usable, and nothing for an account a provider made', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);

    // feature:email-password,magic-link:start
    const byEmail = await browser.get('/api/user/linked-providers').expect(200);

    // Password sign-in is on in this deployment.
    expect(byEmail.body).toMatchObject({
      data: { providers: ['email'], emailSignIn: 'usable' },
    });
    // feature:email-password,magic-link:end

    await e2e.state.auth.makeProviderCreated(SEED_USER.email, 'google', [
      { provider: 'google', providerId: 'google-1', linkedAt: TEST_NOW },
    ]);
    const byProvider = await browser
      .get('/api/user/linked-providers')
      .expect(200);

    expect(byProvider.body).toMatchObject({ data: { providers: ['google'] } });
    expect(Object.keys(byProvider.body.data as object)).not.toContain(
      'emailSignIn',
    );
  });
});
