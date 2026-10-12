import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { exportPKCS8 } from 'jose'; // feature:apple
import request from 'supertest';
import { unwrapNativeAttemptResult, unwrapNativeAttemptStart } from '@app/sdk';
import { GoogleOAuthStrategy } from '../../../src/auth/oauth/strategies/google-oauth.strategy'; // feature:google
import { AppleOAuthStrategy } from '../../../src/auth/oauth/strategies/apple-oauth.strategy'; // feature:apple
import { FacebookOAuthStrategy } from '../../../src/auth/oauth/strategies/facebook-oauth.strategy'; // feature:facebook
import type { OAuthProviderStrategy } from '../../../src/auth/oauth/oauth-provider.interface';
import type { NativeProviderSignInConfiguration } from '../../../src/config/types/native-application.type';
import {
  configFor,
  mockFetch,
  type SigningKey,
} from '../../../src/auth/oauth/strategies/oauth-strategy.harness-spec';
import {
  createSigningKey,
  signedNativeToken,
  NATIVE_AUDIENCE,
} from '../../../src/auth/oauth/strategies/native-provider-proof.harness-spec';
import { resetJwksCache } from '../../../src/auth/oauth/utils/id-token.util';
import { AccountLinkingService } from '../../../src/user/services/account-linking.service';
import { DEFAULT_API_AUDIENCE } from '../../../src/session/constants/client-ids';
import {
  nativeAuthorizeQuery,
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
} from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import { SEED_USER } from '../../constants/seed-users';
import { bootE2eApp, type E2eApp } from '../../utils/e2e-app';
import { TEST_NOW } from '../../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';

const PROVIDERS: ReadonlyArray<
  Pick<NativeProviderSignInConfiguration, 'id' | 'mode'> & {
    issuer: string;
    jwks: string;
  }
> = [
  // feature:google:start
  {
    id: 'google',
    mode: 'googleIdentityToken',
    issuer: 'https://accounts.google.com',
    jwks: 'https://www.googleapis.com/oauth2/v3/certs',
  },
  // feature:google:end
  // feature:apple:start
  {
    id: 'apple',
    mode: 'appleIdentityTokenAndCode',
    issuer: 'https://appleid.apple.com',
    jwks: 'https://appleid.apple.com/auth/keys',
  },
  // feature:apple:end
  // feature:facebook:start
  {
    id: 'facebook',
    mode: 'facebook',
    issuer: 'https://www.facebook.com',
    jwks: 'https://www.facebook.com/.well-known/oauth/openid/jwks/',
  },
  // feature:facebook:end
];
const FETCH = global.fetch;
const ONLY_THE_CALENDAR = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
] as const;

describe.each(PROVIDERS)('native $id provider HTTP proof', (provider) => {
  let e2e: E2eApp;
  let key: SigningKey;
  let strategy: OAuthProviderStrategy;
  const application = {
    clientId: NATIVE_CLIENT_ID,
    displayName: 'Provider test client',
    redirectUris: [NATIVE_REDIRECT],
    allowedScopes: [DEFAULT_API_AUDIENCE],
    signIn: {
      providers: [
        {
          id: provider.id,
          mode: provider.mode,
          ...(provider.id === 'google'
            ? { webClientId: NATIVE_AUDIENCE }
            : { appId: NATIVE_AUDIENCE }),
        },
      ],
    },
  };

  beforeAll(async () => {
    key = await createSigningKey();
    switch (provider.id) {
      // feature:google:start
      case 'google':
        strategy = new GoogleOAuthStrategy(
          configFor('google', {
            clientId: 'web-client',
            clientSecret: 'test-secret',
          }),
        );
        break;
      // feature:google:end
      // feature:apple:start
      case 'apple': {
        const signing = await createSigningKey('ES256', 'native-apple-signing');
        strategy = new AppleOAuthStrategy(
          configFor('apple', {
            clientId: 'web-service',
            extra: {
              TEAM_ID: 'NATIVETEAM',
              KEY_ID: 'native-apple-signing',
              PRIVATE_KEY: await exportPKCS8(signing.privateKey),
            },
          }),
        );
        break;
      }
      // feature:apple:end
      // feature:facebook:start
      case 'facebook':
        strategy = new FacebookOAuthStrategy(
          configFor('facebook', {
            clientId: NATIVE_AUDIENCE,
            clientSecret: 'test-secret',
          }),
        );
        break;
      // feature:facebook:end
    }
    e2e = await bootE2eApp(0, {
      nativeEnabled: true,
      nativeCustomSchemeAllowed: true,
      nativeApplications: [application],
      browserStrategy: strategy,
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    await e2e.reset();
    e2e.clock.set(TEST_NOW);
    e2e.app.get(ConfigService).set('auth.nativeApplications', [application]);
    jest.useFakeTimers({ now: TEST_NOW, doNotFake: [...ONLY_THE_CALENDAR] });
  });
  afterEach(() => {
    global.fetch = FETCH;
    resetJwksCache();
    jest.useRealTimers();
  });

  async function start() {
    const query = nativeAuthorizeQuery(randomBytes(32).toString('base64url'));
    const reply = await request(e2e.httpServer)
      .post('/api/auth/native/attempts')
      .send({
        clientId: NATIVE_CLIENT_ID,
        redirectUri: NATIVE_REDIRECT,
        codeChallenge: query.code_challenge,
        codeChallengeMethod: 'S256',
        state: query.state,
        scopes: [DEFAULT_API_AUDIENCE],
        flow: 'signIn',
      })
      .expect(201);
    return unwrapNativeAttemptStart({ status: reply.status, body: reply.body });
  }

  async function credential(nonce: string, overrides = {}) {
    const token = await signedNativeToken(key, provider.issuer, {
      iat: TEST_NOW.getTime() / 1000,
      exp: TEST_NOW.getTime() / 1000 + 600,
      nonce,
      email: SEED_USER.email,
      sub: `native-${provider.id}-subject`,
      ...overrides,
    });
    mockFetch([
      { url: provider.jwks, body: key.jwks },
      {
        url: 'https://appleid.apple.com/auth/token',
        body: { id_token: token },
      },
    ]);
    if (provider.id === 'apple')
      return {
        kind: 'appleIdentityTokenAndCode',
        identityToken: token,
        authorizationCode: 'one-use-code',
        nonceDigest: nonce,
      };
    if (provider.id === 'facebook')
      return {
        kind: 'facebookLimitedToken',
        authenticationToken: token,
        nonceDigest: nonce,
      };
    return {
      kind: 'googleIdentityToken',
      identityToken: token,
      nonceDigest: nonce,
    };
  }

  async function linkFacebook() {
    if (provider.id !== 'facebook') return;
    const userId = await e2e.state.accounts.accountIdFor(SEED_USER.email);
    if (!userId) throw new Error('seed account absent');
    await e2e.app.get(AccountLinkingService).linkProvider(userId, 'facebook', {
      providerId: 'native-facebook-subject',
      email: SEED_USER.email,
      emailVerified: true,
      name: 'Provider user',
    });
  }

  it('feeds the real signed artifact into the route and SDK consent parser without a browser session', async () => {
    await linkFacebook();
    const attempt = await start();
    const reply = await request(e2e.httpServer)
      .post(`/api/auth/native/attempts/${attempt.attemptId}/provider`)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .send(await credential(attempt.providerNonceDigest))
      .expect(201);
    const view = unwrapNativeAttemptResult({
      status: reply.status,
      body: reply.body,
    });
    expect(view.stage).toBe('consentRequired');
    if (view.stage !== 'consentRequired')
      throw new Error('consent not returned');
    expect(view.account.id).toBe(
      await e2e.state.accounts.accountIdFor(SEED_USER.email),
    );
    expect(view.account.email).toBe(SEED_USER.email);
    expect(reply.headers['set-cookie']).toBeUndefined();
    expect(await e2e.state.sessions.countSessions()).toBe(0);
    const approved = await request(e2e.httpServer)
      .post(`/api/auth/native/attempts/${attempt.attemptId}/consent`)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .expect(201);
    expect(
      unwrapNativeAttemptResult({
        status: approved.status,
        body: approved.body,
      }).stage,
    ).toBe('codeReady');
  });

  it('rejects a claimed nonce different from the stored attempt', async () => {
    const attempt = await start();
    await request(e2e.httpServer)
      .post(`/api/auth/native/attempts/${attempt.attemptId}/provider`)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .send(await credential('b'.repeat(64)))
      .expect(400);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });

  it('rejects a credential after this client disables the configured SDK mode', async () => {
    const attempt = await start();
    e2e.app
      .get(ConfigService)
      .set('auth.nativeApplications', [
        { ...application, signIn: { providers: [] } },
      ]);
    await request(e2e.httpServer)
      .post(`/api/auth/native/attempts/${attempt.attemptId}/provider`)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .send(await credential(attempt.providerNonceDigest))
      .expect(409);
  });

  it('refuses unverified address linking for Google and Apple, and unlinked Facebook identity', async () => {
    const attempt = await start();
    const body = await credential(attempt.providerNonceDigest, {
      email_verified: false,
    });
    const response = await request(e2e.httpServer)
      .post(`/api/auth/native/attempts/${attempt.attemptId}/provider`)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .send(body)
      .expect(provider.id === 'facebook' ? 409 : 403);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });

  it('does not create an account after cancellation while the provider key request is pending', async () => {
    const attempt = await start();
    const body = await credential(attempt.providerNonceDigest, {
      email: 'cancelled-provider@example.test',
    });
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pendingKey = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const providerFetch = global.fetch;
    global.fetch = async (input, init) => {
      entered();
      await waiting;
      return providerFetch(input, init);
    };
    const pending = request(e2e.httpServer)
      .post(`/api/auth/native/attempts/${attempt.attemptId}/provider`)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .send(body)
      .then((response) => response);
    try {
      await pendingKey;
      await request(e2e.httpServer)
        .post(`/api/auth/native/attempts/${attempt.attemptId}/cancel`)
        .set('X-Native-Attempt', attempt.attemptSecret)
        .expect(201);
    } finally {
      release();
    }
    expect((await pending).status).toBe(409);
    expect(
      await e2e.state.accounts.accountIdFor('cancelled-provider@example.test'),
    ).toBeNull();
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });
});
