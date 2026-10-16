import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import {
  type TokenSet,
  unwrapNativeAttemptResult,
  unwrapNativeAttemptStart,
} from '@app/sdk';
import { NATIVE_ATTEMPT_HEADER } from '../../../src/auth/native/constants/native-attempt';
import { NativeAttemptService } from '../../../src/auth/native/services/native-attempt.service';
import { SessionValidator } from '../../../src/session/authority/session-validator';
import { DEFAULT_API_AUDIENCE } from '../../../src/session/constants/client-ids';
import {
  NATIVE_META,
  nativeAuthorizeQuery,
} from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import { NativeTokenService } from '../../../src/session/native/token/native-token.service';
import { reconcileStartupApplications } from '../../../src/session/session.module';
import { hashToken } from '../../../src/session/utils/hashing/token-hash';
import { AccountProfileStore } from '../../../src/user/stores/account-profile.store';
import { SEED_USER } from '../../constants/seed-users';
import {
  bootE2eApp,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../../utils/e2e-app';
import { TEST_NOW } from '../../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import {
  beginNativeAuthorization,
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
  seedUserId,
} from '../../utils/native/native-authorize.fixtures';
import { publicClient, required } from '../../utils/sdk/sdk-transport';

const REGISTER_OPTIONS = '/api/auth/native/passkeys/register/options';
const PROFILE = '/api/user/profile';
const MINUTE_MS = 60_000;
/** Within the browser's 30-minute idle limit, so it stays signed in. */
const BROWSER_USE_EVERY_MINUTES = 25;
const AN_HOUR_LATER = minutesAfterSignIn(60);
const APPLICATION = {
  clientId: NATIVE_CLIENT_ID,
  displayName: 'Native authentication time client',
  redirectUris: [NATIVE_REDIRECT],
  allowedScopes: [DEFAULT_API_AUDIENCE],
  signIn: {
    passkeys: true,
    rpId: 'localhost',
    origins: ['https://localhost'],
  },
};
/** Mobile sessions of one hour, shorter than the browser sign-in is old. */
const ONE_HOUR_APPLICATION = {
  ...APPLICATION,
  session: {
    bound: { absoluteHours: 1, idleMinutes: 60 },
    unbound: { absoluteHours: 1, idleMinutes: 60 },
  },
};

function minutesAfterSignIn(minutes: number): Date {
  return new Date(TEST_NOW.getTime() + minutes * MINUTE_MS);
}

interface Refusal {
  status: number;
  code: unknown;
}

describe('when a native session counts as signed in (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    // The reset registers the configured app, so it is set first.
    const config = e2e.app.get(ConfigService);
    config.set('auth.nativeEnabled', true);
    config.set('auth.nativeApplications', [APPLICATION]);
    await e2e.reset();
  });

  /** Signs the browser in at `TEST_NOW` and keeps it in use until `minutes` later. */
  async function browserSignedInFor(minutes: number): Promise<TestAgent> {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    for (
      let used = BROWSER_USE_EVERY_MINUTES;
      used < minutes;
      used += BROWSER_USE_EVERY_MINUTES
    ) {
      e2e.clock.set(minutesAfterSignIn(used));
      await browser.get(PROFILE).expect(200);
    }
    e2e.clock.set(minutesAfterSignIn(minutes));
    return browser;
  }

  /** A signed-in browser approves the app's request, then the app exchanges the code. */
  async function approvedFromBrowser(browser: TestAgent): Promise<TokenSet> {
    const started = await beginNativeAuthorization(e2e);
    const approval = await browser
      .post('/api/oauth/authorize/approve')
      .send({
        transactionId: started.transactionId,
        expectedUserId: await seedUserId(e2e),
      })
      .expect(200);
    const { data } = approval.body as { data: { redirectUri: string } };
    return exchange(data.redirectUri, started.verifier);
  }

  /** A passkey sign-in inside the app, then its consent and exchange. */
  async function signedInWithinApp(): Promise<TokenSet> {
    const verifier = randomBytes(32).toString('base64url');
    const query = nativeAuthorizeQuery(verifier);
    const started = await request(e2e.httpServer)
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
    const attempt = unwrapNativeAttemptStart({
      status: started.status,
      body: started.body,
    });
    const userId = await seedUserId(e2e);
    const account = await e2e.app.get(AccountProfileStore).findProfile(userId);
    await e2e.app
      .get(NativeAttemptService)
      .completeFactor(attempt.attemptId, attempt.attemptSecret, {
        userId,
        userVersion: required(account, 'seed account').sessionVersion,
        firstFactor: 'passkey',
        authenticationMethods: ['hwk'],
        passkeyUserVerified: true,
      });
    const consent = await request(e2e.httpServer)
      .post(`/api/auth/native/attempts/${attempt.attemptId}/consent`)
      .set(NATIVE_ATTEMPT_HEADER, attempt.attemptSecret)
      .expect(201);
    const reply = unwrapNativeAttemptResult({
      status: consent.status,
      body: consent.body,
    });
    if (reply.stage !== 'codeReady') throw new Error('no code was issued');
    return exchange(reply.redirectUri, verifier);
  }

  function exchange(redirectUri: string, verifier: string): Promise<TokenSet> {
    return publicClient(e2e).oauth.exchangeCode({
      code: required(new URL(redirectUri).searchParams.get('code'), 'code'),
      codeVerifier: verifier,
      redirectUri: NATIVE_REDIRECT,
      clientId: NATIVE_CLIENT_ID,
    });
  }

  async function authenticatedAtOf(tokens: TokenSet): Promise<Date> {
    const [credential] = await e2e.state.native.credentialsForTokens([
      hashToken(tokens.refreshToken),
    ]);
    const session = await e2e.app
      .get(SessionValidator)
      .findById(required(credential, 'refresh credential').sessionId);
    return required(session, 'native session').authenticatedAt;
  }

  async function passkeyOptionsFor(tokens: TokenSet): Promise<Refusal> {
    const answer = await request(e2e.httpServer)
      .post(REGISTER_OPTIONS)
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({});
    const body = answer.body as { error?: { code?: unknown } };
    return { status: answer.status, code: body.error?.code };
  }

  function refreshed(refreshToken: string) {
    return e2e.app.get(NativeTokenService).grant(
      {
        grant_type: 'refresh_token',
        client_id: NATIVE_CLIENT_ID,
        refresh_token: refreshToken,
      },
      NATIVE_META,
    );
  }

  // Failure: a browser left signed in for an hour mints a mobile session that passes the five-minute rule.
  it('gives a browser-approved mobile session the browser sign-in time, so adding a passkey needs a fresh sign-in', async () => {
    const browser = await browserSignedInFor(60);

    const tokens = await approvedFromBrowser(browser);

    expect(await authenticatedAtOf(tokens)).toEqual(TEST_NOW);
    expect(await passkeyOptionsFor(tokens)).toEqual({
      status: 401,
      code: 'REAUTH_REQUIRED',
    });
  });

  // Failure: a sign-in inside the app stops counting as fresh and cannot add a passkey.
  it('gives a mobile session signed in within the app its issue time, so it can add a passkey', async () => {
    e2e.clock.set(AN_HOUR_LATER);

    const tokens = await signedInWithinApp();

    expect(await authenticatedAtOf(tokens)).toEqual(AN_HOUR_LATER);
    expect((await passkeyOptionsFor(tokens)).status).toBe(200);
  });

  // Failure: a lifetime counted from an old browser sign-in ends the mobile session as it is issued.
  it('gives a browser-approved mobile session its whole lifetime from the approval, kept by refresh until it ends, while adding a passkey still needs a fresh sign-in', async () => {
    e2e.app
      .get(ConfigService)
      .set('auth.nativeApplications', [ONE_HOUR_APPLICATION]);
    await reconcileStartupApplications(e2e.app);
    const browser = await browserSignedInFor(120);

    const tokens = await approvedFromBrowser(browser);

    await request(e2e.httpServer)
      .get(PROFILE)
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);
    expect(await passkeyOptionsFor(tokens)).toEqual({
      status: 401,
      code: 'REAUTH_REQUIRED',
    });
    e2e.clock.set(minutesAfterSignIn(175));
    const rotated = await refreshed(tokens.refreshToken);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) throw new Error('refresh inside the lifetime failed');
    e2e.clock.set(minutesAfterSignIn(180));
    expect(await refreshed(rotated.refreshToken)).toEqual({
      ok: false,
      status: 400,
      error: 'invalid_grant',
    });
  });
});
