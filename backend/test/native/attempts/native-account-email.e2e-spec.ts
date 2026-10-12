import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { unwrapNativeAttemptResult, unwrapNativeAttemptStart } from '@app/sdk';
import { GoogleOAuthStrategy } from '../../../src/auth/oauth/strategies/google-oauth.strategy';
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
import { NATIVE_ATTEMPT_HEADER } from '../../../src/auth/native/constants/native-attempt';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import type { NativeApplicationConfiguration } from '../../../src/config/types/native-application.type';
import { DEFAULT_API_AUDIENCE } from '../../../src/session/constants/client-ids';
import {
  nativeAuthorizeQuery,
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
} from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import { bootE2eApp, type E2eApp } from '../../utils/e2e-app';
import { TEST_NOW } from '../../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';

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
const PROVIDER_ID = 'legacy-native-email-subject';
const CLAIM_EMAIL = 'current-provider@example.test';
const EMAIL_SUFFIX = '@example.test';
const MAX_EMAIL = `${'a'.repeat(255 - EMAIL_SUFFIX.length)}${EMAIL_SUFFIX}`;
const OVERLONG_EMAIL = `${'a'.repeat(256 - EMAIL_SUFFIX.length)}${EMAIL_SUFFIX}`;
const APPLICATION = {
  clientId: NATIVE_CLIENT_ID,
  displayName: 'Native account email client',
  redirectUris: [NATIVE_REDIRECT],
  allowedScopes: [DEFAULT_API_AUDIENCE],
  signIn: {
    providers: [
      {
        id: 'google',
        mode: 'googleIdentityToken',
        webClientId: NATIVE_AUDIENCE,
      },
    ],
  },
} satisfies NativeApplicationConfiguration;

describe('native linked account email boundary (e2e)', () => {
  let e2e: E2eApp;
  let key: SigningKey;

  beforeAll(async () => {
    key = await createSigningKey();
    e2e = await bootE2eApp(0, {
      nativeEnabled: true,
      nativeCustomSchemeAllowed: true,
      nativeApplications: [APPLICATION],
      browserStrategy: new GoogleOAuthStrategy(
        configFor('google', {
          clientId: 'web-client',
          clientSecret: 'test-secret',
        }),
      ),
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    await e2e.reset();
    e2e.clock.set(TEST_NOW);
    jest.useFakeTimers({ now: TEST_NOW, doNotFake: [...ONLY_THE_CALENDAR] });
  });

  afterEach(() => {
    global.fetch = FETCH;
    resetJwksCache();
    jest.useRealTimers();
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  async function linkedAccount(email: string): Promise<string> {
    const { _id: userId } = await e2e.state.accounts.createAccount({
      email,
      name: 'Legacy provider account',
      isVerified: true,
    });
    await e2e.app.get(AccountLinkingService).linkProvider(userId, 'google', {
      providerId: PROVIDER_ID,
      email,
      emailVerified: true,
      name: 'Legacy provider account',
    });
    expect((await e2e.state.accounts.accountWithId(userId))?.email).toBe(email);
    return userId;
  }

  async function start() {
    const query = nativeAuthorizeQuery(randomBytes(32).toString('base64url'));
    const response = await request(e2e.httpServer)
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
    return unwrapNativeAttemptStart(response);
  }

  async function prove(
    attempt: Awaited<ReturnType<typeof start>>,
    status: number,
  ) {
    const token = await signedNativeToken(key, 'https://accounts.google.com', {
      iat: TEST_NOW.getTime() / 1000,
      exp: TEST_NOW.getTime() / 1000 + 600,
      nonce: attempt.providerNonceDigest,
      email: CLAIM_EMAIL,
      sub: PROVIDER_ID,
    });
    mockFetch([
      { url: 'https://www.googleapis.com/oauth2/v3/certs', body: key.jwks },
    ]);
    return request(e2e.httpServer)
      .post(`/api/auth/native/attempts/${attempt.attemptId}/provider`)
      .set(NATIVE_ATTEMPT_HEADER, attempt.attemptSecret)
      .send({
        kind: 'googleIdentityToken',
        identityToken: token,
        nonceDigest: attempt.providerNonceDigest,
      })
      .expect(status);
  }

  it('returns an SDK-readable consent for a 255-unit stored address', async () => {
    const userId = await linkedAccount(MAX_EMAIL);
    const attempt = await start();
    const response = await prove(attempt, 201);
    const parsed = unwrapNativeAttemptResult(response);
    expect(parsed.stage).toBe('consentRequired');
    if (parsed.stage !== 'consentRequired') throw new Error('consent missing');
    expect(parsed.account).toMatchObject({ id: userId, email: MAX_EMAIL });
    expect((await e2e.state.accounts.accountWithId(userId))?.email).toBe(
      MAX_EMAIL,
    );
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });

  it.each([
    ['overlong', OVERLONG_EMAIL],
    ['malformed', 'legacy-address-without-domain'],
  ])('returns a structured error for a %s stored address', async (_, email) => {
    const userId = await linkedAccount(email);
    const attempt = await start();
    const response = await prove(attempt, 500);
    expect(response.body.error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(response.headers['set-cookie']).toBeUndefined();

    const resumed = await request(e2e.httpServer)
      .get(`/api/auth/native/attempts/${attempt.attemptId}`)
      .set(NATIVE_ATTEMPT_HEADER, attempt.attemptSecret)
      .expect(500);
    expect(resumed.body.error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect((await e2e.state.accounts.accountWithId(userId))?.email).toBe(email);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
    expect(await e2e.state.native.credentialCount()).toBe(0);
  });
});
