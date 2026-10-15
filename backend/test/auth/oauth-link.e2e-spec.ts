import { WEB_CLIENT_ID } from '../../src/session/constants/client-ids';
import { OAUTH_STATE_COOKIE_PREFIX } from '../../src/auth/oauth/oauth.constants';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import type { OAuthProviderStrategy } from '../../src/auth/oauth/oauth-provider.interface';
import { SEED_USER } from '../constants/seed-users';
import request, { type Response } from 'supertest';
import {
  bootE2eApp,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { TEST_NOW } from '../utils/frozen-clock';
import { describeBrowserOAuthApplications } from './oauth-browser-applications.harness-spec';

/** The state the last start handed to the provider. */
let offeredState = '';

/** The provider account of the person signed in as the seed user. */
const PROVIDER_ACCOUNT = {
  providerId: 'google-seed-user',
  email: SEED_USER.email,
  emailVerified: true,
  name: 'Seed User',
};

const GOOGLE_STRATEGY: OAuthProviderStrategy = {
  id: 'google',
  displayName: 'Google',
  envPrefix: 'OAUTH_GOOGLE',
  supportsPkce: true,
  usesOidc: false,
  emailAlwaysVerified: true,
  autoLinksByEmail: true,
  callbackMethod: 'GET',
  isEnabled: () => true,
  getAuthorizationUrl: ({ state }) => {
    offeredState = state;
    return 'https://provider.example/authorize';
  },
  exchangeCode: () => Promise.resolve({ accessToken: 'provider-token' }),
  fetchProfile: () => Promise.resolve(PROVIDER_ACCOUNT),
};

interface StartedLink {
  state: string;
  stateCookie: string;
}

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

  async function startLink(browser: TestAgent): Promise<StartedLink> {
    const started = await browser
      .get('/api/auth/oauth/google/start')
      .query({ intent: 'link' })
      .redirects(0);
    const cookies: unknown = started.headers['set-cookie'];
    const stateCookie = (Array.isArray(cookies) ? cookies : [])
      .map(String)
      .find((cookie) =>
        cookie.startsWith(
          `${OAUTH_STATE_COOKIE_PREFIX}${WEB_CLIENT_ID}_google=`,
        ),
      );
    if (!stateCookie) throw new Error('the start set no state cookie');
    return { state: offeredState, stateCookie: stateCookie.split(';')[0] };
  }

  /**
   * The provider's site sends the browser back. A browser sends no
   * SameSite=Strict cookie with that navigation, so the session cookie is not
   * here: only the state cookie, which is Lax.
   */
  function providerReturns(link: StartedLink): Promise<Response> {
    return request(e2e.httpServer)
      .get('/api/auth/oauth/google/callback')
      .query({ state: link.state, code: 'provider-code' })
      .set('Cookie', link.stateCookie)
      .redirects(0);
  }

  function answerOf(response: Response): Record<string, string | null> {
    const location = new URL(String(response.headers.location));
    return {
      status: location.searchParams.get('status'),
      code: location.searchParams.get('code'),
    };
  }

  async function googleLinked(browser: TestAgent): Promise<boolean> {
    const listed = await browser.get('/api/user/linked-providers').expect(200);
    const { providers } = (listed.body as { data: { providers: string[] } })
      .data;
    return providers.includes('google');
  }

  it('links the provider when the callback arrives without the session cookie', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const link = await startLink(browser);

    const returned = await providerReturns(link);

    expect({
      answer: answerOf(returned),
      linked: await googleLinked(browser),
    }).toEqual({
      answer: { status: 'ok', code: null },
      linked: true,
    });
    expect(await e2e.captureMail()).toMatchObject([
      {
        to: SEED_USER.email,
        subject: 'A sign-in provider was added',
      },
    ]);
  });

  it('refuses the callback when the session that started the link was signed out since', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const link = await startLink(browser);
    await browser.post('/api/auth/logout').expect(200);

    const returned = await providerReturns(link);

    expect({
      answer: answerOf(returned),
      linked: await googleLinked(await loginAs(e2e.httpServer, SEED_USER)),
    }).toEqual({
      answer: { status: 'error', code: 'SESSION_INVALID' },
      linked: false,
    });
  });

  it('refuses the same callback a second time', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const link = await startLink(browser);
    await providerReturns(link);

    const replayed = await providerReturns(link);

    expect({
      answer: answerOf(replayed),
      linked: await googleLinked(browser),
    }).toEqual({
      answer: { status: 'error', code: 'PROVIDER_ALREADY_LINKED' },
      linked: true,
    });
    expect(await e2e.captureMail()).toHaveLength(1);
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

describeBrowserOAuthApplications(GOOGLE_STRATEGY, () => offeredState);
