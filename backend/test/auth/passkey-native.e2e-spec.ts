import { nativeProviderLinkBoot } from './native-provider-link-cases.harness-spec'; // feature:google
import { randomBytes } from 'node:crypto';
import { nativeProofCases } from './native-proof-cases.harness-spec';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { unwrapNativeAttemptResult } from '@app/sdk';
import {
  createSoftwareAuthenticator,
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
  attestationCredential,
  signAssertion,
  type SoftwareAuthenticator,
} from '../../src/auth/passkeys/services/software-authenticator.harness-spec';
import { DEFAULT_API_AUDIENCE } from '../../src/session/constants/client-ids';
import { reconcileStartupApplications } from '../../src/session/session.module';
import { nativeAuthorizeQuery } from '../../src/session/native/harness/native-oauth-requests.harness-spec';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import { bootE2eApp, loginAs, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  issueNativeGrantFor,
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
  seedUserId,
} from '../utils/native/native-authorize.fixtures';
import { publicClient, signInNative } from '../utils/sdk/sdk-transport';

const OPTIONS = '/api/auth/native/passkeys/register/options';
const VERIFY = '/api/auth/native/passkeys/register/verify';
const PASSKEYS = '/api/auth/passkeys';
const RP_ID = 'localhost';
const ORIGIN = 'https://localhost';
const VERIFIED_TOUCH = FLAG_USER_PRESENT | FLAG_USER_VERIFIED;
const APPLICATION = {
  clientId: NATIVE_CLIENT_ID,
  displayName: 'Native passkey test client',
  redirectUris: [NATIVE_REDIRECT],
  allowedScopes: [DEFAULT_API_AUDIENCE],
  signIn: { password: true, passkeys: true, rpId: RP_ID, origins: [ORIGIN] },
};
/** A second app on the same relying party, so only the session tells the two apart. */
const SECOND_APPLICATION = {
  ...APPLICATION,
  clientId: 'native-app-two',
  displayName: 'Second native passkey test client',
};

interface Answered {
  status: number;
  body: unknown;
}

function refusalOf(answer: Answered): { status: number; code: string } {
  const { error } = answer.body as { error: { code: string } };
  return { status: answer.status, code: error.code };
}

function dataOf<Data>(answer: Answered): Data {
  return (answer.body as { data: Data }).data;
}

describe('passkeys from a signed-in mobile app (e2e)', () => {
  let e2e: E2eApp;
  nativeProofCases(() => ({
    e2e,
    application: APPLICATION,
    register: registerFromApp,
    signIn: signInWith,
    finish: finishSignIn,
  }));

  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      ...nativeProviderLinkBoot(), // feature:google
    });
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
    await e2e.state.auth.removeEveryPasskey();
  });

  /** Calls the API the way the app does: a bearer token and no cookie. */
  function bearer(token: string) {
    const auth = `Bearer ${token}`;
    const api = () => request(e2e.httpServer);
    return {
      post: (path: string, body: object = {}) =>
        api().post(path).set('Authorization', auth).send(body),
      patch: (path: string, body: object) =>
        api().patch(path).set('Authorization', auth).send(body),
      get: (path: string) => api().get(path).set('Authorization', auth),
      delete: (path: string) => api().delete(path).set('Authorization', auth),
    };
  }

  /** Options, the system prompt answered by a software key, then verify. */
  async function registerFromApp(token: string) {
    const app = bearer(token);
    const options = await app.post(OPTIONS).expect(200);
    const key = createSoftwareAuthenticator(randomBytes(32));
    const response = attestationCredential(key, {
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: dataOf<{ challenge: string }>(options).challenge,
      flags: VERIFIED_TOUCH,
      counter: 0,
    });
    const verified = await app.post(VERIFY, { response, name: 'Phone' });
    return { key, response, verified };
  }

  /** A native passkey sign-in with the key, through to the attempt's stage. */
  async function signInWith(
    key: SoftwareAuthenticator,
    counter: number,
    flags = VERIFIED_TOUCH,
  ) {
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
    const attempt = dataOf<{ attemptId: string; attemptSecret: string }>(
      started,
    );
    const path = `/api/auth/native/attempts/${attempt.attemptId}/passkey`;
    const options = await request(e2e.httpServer)
      .post(`${path}/options`)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .expect(201);
    const signed = signAssertion(key, {
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: dataOf<{ challenge: string }>(options).challenge,
      flags,
      counter,
    });
    const answered = await request(e2e.httpServer)
      .post(`${path}/verify`)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .send({
        response: {
          id: key.credentialId,
          rawId: key.credentialId,
          type: 'public-key',
          response: {
            authenticatorData: signed.authenticatorData.toString('base64url'),
            clientDataJSON: signed.clientDataJSON.toString('base64url'),
            signature: signed.signature.toString('base64url'),
            userHandle: Buffer.from(await seedUserId(e2e)).toString(
              'base64url',
            ),
          },
        },
      });
    return { answered, attempt, verifier, options };
  }

  /** Consent, then the code exchanged the way the app exchanges it. */
  async function finishSignIn(
    attempt: { attemptId: string; attemptSecret: string },
    verifier: string,
  ) {
    const consent = await request(e2e.httpServer)
      .post(`/api/auth/native/attempts/${attempt.attemptId}/consent`)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .expect(201);
    const reply = unwrapNativeAttemptResult({
      status: consent.status,
      body: consent.body,
    });
    if (reply.stage !== 'codeReady') throw new Error('no code was issued');
    const code = new URL(reply.redirectUri).searchParams.get('code');
    if (!code) throw new Error('the redirect carries no code');
    return publicClient(e2e).oauth.exchangeCode({
      code,
      codeVerifier: verifier,
      redirectUri: NATIVE_REDIRECT,
      clientId: NATIVE_CLIENT_ID,
    });
  }

  it('creates a passkey from a fresh mobile sign-in that is listed and signs in next time', async () => {
    const { tokens } = await signInNative(e2e);

    const { key, verified } = await registerFromApp(tokens.accessToken);

    expect(verified.status).toBe(200);
    const listed = await bearer(tokens.accessToken).get(PASSKEYS).expect(200);
    expect(
      dataOf<{ passkeys: { name: string }[] }>(listed).passkeys.map(
        (passkey) => passkey.name,
      ),
    ).toEqual(['Phone']);

    const next = await signInWith(key, 1);
    expect(
      unwrapNativeAttemptResult({
        status: next.answered.status,
        body: next.answered.body,
      }).stage,
    ).toBe('consentRequired');
    const signedIn = await finishSignIn(next.attempt, next.verifier);
    const profile = await bearer(signedIn.accessToken)
      .get('/api/user/profile')
      .expect(200);
    expect(dataOf<{ email: string }>(profile).email).toBe(SEED_USER.email);
  });

  it('refuses a browser cookie on the native routes', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    expect(
      refusalOf(await browser.post('/api/auth/native/proof/options').send({})),
    ).toEqual({ status: 401, code: 'SESSION_REQUIRED' });

    expect(refusalOf(await browser.post(OPTIONS).send({}))).toEqual({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(await e2e.state.auth.countPasskeys()).toBe(0);
  });

  it('refuses verify once the mobile session has ended between options and verify', async () => {
    const { tokens } = await signInNative(e2e);
    const app = bearer(tokens.accessToken);
    const options = await app.post(OPTIONS).expect(200);
    await publicClient(e2e).oauth.revoke({
      token: tokens.refreshToken,
      clientId: NATIVE_CLIENT_ID,
    });

    const response = attestationCredential(
      createSoftwareAuthenticator(randomBytes(32)),
      {
        rpId: RP_ID,
        origin: ORIGIN,
        challenge: dataOf<{ challenge: string }>(options).challenge,
        flags: VERIFIED_TOUCH,
        counter: 0,
      },
    );

    expect(refusalOf(await app.post(VERIFY, { response }))).toEqual({
      status: 401,
      code: 'SESSION_INVALID',
    });
    expect(await e2e.state.auth.countPasskeys()).toBe(0);
  });

  it('renames and removes with a mobile token, refusing a blank name and another account`s passkey', async () => {
    const { tokens } = await signInNative(e2e);
    const app = bearer(tokens.accessToken);
    const { key, verified } = await registerFromApp(tokens.accessToken);
    const ownId = dataOf<{ id: string }>(verified).id;
    const theirs = await e2e.state.auth.storePasskey(SEED_ADMIN.email, {
      credentialId: 'YWRtaW4tY3JlZGVudGlhbA',
      publicKey: Buffer.from([1, 2, 3]),
      counter: 0,
      transports: ['internal'],
      deviceType: 'singleDevice',
      backedUp: false,
      name: 'Admin key',
      lastUsedAt: null,
    });

    const blank = await app.patch(`${PASSKEYS}/${ownId}`, { name: '   ' });
    const renamed = await app.patch(`${PASSKEYS}/${ownId}`, { name: 'Work' });
    const stranger = await app.delete(`${PASSKEYS}/${theirs}`);

    expect(refusalOf(blank)).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
    expect(dataOf<{ name: string }>(renamed).name).toBe('Work');
    expect(refusalOf(stranger)).toEqual({
      status: 404,
      code: 'PASSKEY_NOT_FOUND',
    });
    expect(await e2e.state.auth.countPasskeys()).toBe(2);

    await app.delete(`${PASSKEYS}/${ownId}`).expect(200);
    expect(await e2e.state.auth.countPasskeys()).toBe(1);
    expect((await signInWith(key, 1)).answered.status).toBe(409);
  });

  // Failure: a registration challenge one app's session took is spent by
  // another app's session of the same account.
  it("refuses one app's registration challenge under another app's session", async () => {
    e2e.app
      .get(ConfigService)
      .set('auth.nativeApplications', [APPLICATION, SECOND_APPLICATION]);
    await reconcileStartupApplications(e2e.app);
    const { tokens } = await signInNative(e2e);
    const second = await issueNativeGrantFor(
      e2e,
      SEED_USER.email,
      SECOND_APPLICATION.clientId,
    );
    const options = await bearer(tokens.accessToken).post(OPTIONS).expect(200);
    const response = attestationCredential(
      createSoftwareAuthenticator(randomBytes(32)),
      {
        rpId: RP_ID,
        origin: ORIGIN,
        challenge: dataOf<{ challenge: string }>(options).challenge,
        flags: VERIFIED_TOUCH,
        counter: 0,
      },
    );

    const replayed = await bearer(second.accessToken).post(VERIFY, {
      response,
    });
    expect(refusalOf(replayed)).toEqual({
      status: 401,
      code: 'PASSKEY_CHALLENGE_INVALID',
    });
    expect(await e2e.state.auth.countPasskeys()).toBe(0);
    // The app the challenge was issued to can still spend it.
    await bearer(tokens.accessToken).post(VERIFY, { response }).expect(200);
    expect(await e2e.state.auth.countPasskeys()).toBe(1);
  });
});
