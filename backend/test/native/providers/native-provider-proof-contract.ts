import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { unwrapNativeAttemptResult, unwrapNativeAttemptStart } from '@app/sdk';
import type { OAuthProviderStrategy } from '../../../src/auth/oauth/oauth-provider.interface';
import type { NativeProviderSignInConfiguration } from '../../../src/config/types/native-application.type';
import {
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

export interface NativeSdkProvider extends Pick<
  NativeProviderSignInConfiguration,
  'id' | 'mode'
> {
  issuer: string;
  jwks: string;
  /** The provider's browser strategy, built the way the server builds it. */
  strategy: () => Promise<OAuthProviderStrategy>;
}

const FETCH = global.fetch;
/** An address with no account, so a provider sign-in creates one. */
const NEWCOMER = 'native-newcomer@example.test';
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

/**
 * One SDK provider's proof over HTTP. Each provider's spec calls it, so a
 * project keeps exactly the providers it was generated with.
 */
export function describeNativeProviderProof(provider: NativeSdkProvider): void {
  describe(`native ${provider.id} provider HTTP proof`, () => {
    let e2e: E2eApp;
    let key: SigningKey;
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
      e2e = await bootE2eApp(0, {
        nativeEnabled: true,
        nativeCustomSchemeAllowed: true,
        nativeApplications: [application],
        browserStrategy: await provider.strategy(),
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
      return unwrapNativeAttemptStart({
        status: reply.status,
        body: reply.body,
      });
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
      await e2e.app
        .get(AccountLinkingService)
        .linkProvider(userId, 'facebook', {
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

    /** A sign-in for the newcomer, with extra body fields and a header language. */
    async function signUp(
      extra: Record<string, unknown>,
      language: string,
      status: number,
    ) {
      const attempt = await start();
      const body = await credential(attempt.providerNonceDigest, {
        email: NEWCOMER,
      });
      return request(e2e.httpServer)
        .post(`/api/auth/native/attempts/${attempt.attemptId}/provider`)
        .set('X-Native-Attempt', attempt.attemptSecret)
        .set('Accept-Language', language)
        .send({ ...body, ...extra })
        .expect(status);
    }

    // Facebook never creates an account for an address it cannot link.
    if (provider.id !== 'facebook') {
      // feature:locale-ar:start
      // feature:locale-ar:end

      it('signs up with a body language the build lacks, stored as en', async () => {
        await signUp({ locale: 'fr' }, 'en', 201);
        expect(
          (await e2e.state.accounts.accountWithAddress(NEWCOMER))?.locale,
        ).toBe('en');
      });
    }

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
        await e2e.state.accounts.accountIdFor(
          'cancelled-provider@example.test',
        ),
      ).toBeNull();
      expect(await e2e.state.sessions.countSessions()).toBe(0);
    });
  });
}
