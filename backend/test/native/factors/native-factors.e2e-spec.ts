import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import {
  unwrapNativeAttemptResult,
  unwrapNativeAttemptStart,
  unwrapNativePasskeyOptions,
} from '@app/sdk';
import { PasskeyStore } from '../../../src/auth/passkeys/stores/passkey.store';
import {
  createSoftwareAuthenticator,
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
  signAssertion,
  type SoftwareAuthenticator,
  type CeremonyInput,
} from '../../../src/auth/passkeys/services/software-authenticator.harness-spec';
import { DEFAULT_API_AUDIENCE } from '../../../src/session/constants/client-ids';
import {
  nativeAuthorizeQuery,
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
} from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import { SEED_USER } from '../../constants/seed-users';
import { bootE2eApp, loginAs, type E2eApp } from '../../utils/e2e-app';
import {
  applyTwoFactorEnv,
  enrolTwoFactor,
} from '../../utils/auth/two-factor-enrolment';
import { TEST_NOW } from '../../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';

const ORIGIN = 'https://localhost';
const RP_ID = 'localhost';
function assertion(
  key: SoftwareAuthenticator,
  userId: string,
  input: CeremonyInput,
) {
  const signed = signAssertion(key, input);
  return {
    id: key.credentialId,
    rawId: key.credentialId,
    type: 'public-key',
    response: {
      authenticatorData: signed.authenticatorData.toString('base64url'),
      clientDataJSON: signed.clientDataJSON.toString('base64url'),
      signature: signed.signature.toString('base64url'),
      userHandle: Buffer.from(userId).toString('base64url'),
    },
  };
}
const APPLICATION = {
  clientId: NATIVE_CLIENT_ID,
  displayName: 'Native factor test client',
  redirectUris: [NATIVE_REDIRECT],
  allowedScopes: [DEFAULT_API_AUDIENCE],
  signIn: { password: true, passkeys: true, rpId: RP_ID, origins: [ORIGIN] },
};

describe('native password and passkey factors (e2e)', () => {
  let e2e: E2eApp;
  let restoreEnv: () => void;

  beforeAll(async () => {
    restoreEnv = applyTwoFactorEnv();
    e2e = await bootE2eApp(0, {
      nativeEnabled: true,
      nativeCustomSchemeAllowed: true,
      nativeApplications: [APPLICATION],
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
    restoreEnv();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    e2e.app.get(ConfigService).set('auth.nativeApplications', [APPLICATION]);
    await e2e.reset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

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
    return unwrapNativeAttemptStart({
      status: response.status,
      body: response.body,
    });
  }

  function path(id: string, suffix: string): string {
    return `/api/auth/native/attempts/${id}/${suffix}`;
  }

  async function password(attempt: {
    attemptId: string;
    attemptSecret: string;
  }) {
    return request(e2e.httpServer)
      .post(path(attempt.attemptId, 'password'))
      .set('X-Native-Attempt', attempt.attemptSecret)
      .send({ email: SEED_USER.email, password: SEED_USER.password });
  }

  async function enrol() {
    jest.useFakeTimers({
      now: TEST_NOW,
      doNotFake: [
        'nextTick',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    return enrolTwoFactor(browser, SEED_USER.password, TEST_NOW);
  }

  it('accepts a real password and returns SDK parseable consent without a cookie', async () => {
    const attempt = await start();
    const response = await request(e2e.httpServer)
      .post(path(attempt.attemptId, 'password'))
      .set('X-Native-Attempt', attempt.attemptSecret)
      .send({ email: SEED_USER.email, password: SEED_USER.password })
      .expect(201);
    expect(
      unwrapNativeAttemptResult({
        status: response.status,
        body: response.body,
      }).stage,
    ).toBe('consentRequired');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('refuses unknown, passwordless, and wrong passwords with the same status', async () => {
    await e2e.state.auth.removePassword(SEED_USER.email);
    const inputs = [
      { email: SEED_USER.email, password: SEED_USER.password },
      { email: 'missing@example.test', password: SEED_USER.password },
      { email: 'admin@seed.local', password: 'wrong-password' },
    ];
    for (const input of inputs) {
      const attempt = await start();
      await request(e2e.httpServer)
        .post(path(attempt.attemptId, 'password'))
        .set('X-Native-Attempt', attempt.attemptSecret)
        .send(input)
        .expect(401);
    }
  });

  it('accepts a signed native passkey once and rejects a reused challenge', async () => {
    const userId = await e2e.state.accounts.accountIdFor(SEED_USER.email);
    if (!userId) throw new Error('seed account missing');
    const authenticator = createSoftwareAuthenticator(randomBytes(32));
    await e2e.state.auth.storePasskey(SEED_USER.email, {
      credentialId: authenticator.credentialId,
      publicKey: authenticator.cosePublicKey,
      counter: 3,
      transports: ['internal'],
      deviceType: 'singleDevice',
      backedUp: false,
      name: 'Native fixture',
      lastUsedAt: null,
      rpId: RP_ID,
    });
    const attempt = await start();
    const optionsResponse = await request(e2e.httpServer)
      .post(path(attempt.attemptId, 'passkey/options'))
      .set('X-Native-Attempt', attempt.attemptSecret)
      .expect(201);
    const options = unwrapNativePasskeyOptions({
      status: optionsResponse.status,
      body: optionsResponse.body,
    });
    const proof = assertion(authenticator, userId, {
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: options.challenge,
      flags: FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
      counter: 4,
    });
    const accepted = await request(e2e.httpServer)
      .post(path(attempt.attemptId, 'passkey/verify'))
      .set('X-Native-Attempt', attempt.attemptSecret)
      .send({ response: proof })
      .expect(201);
    expect(
      unwrapNativeAttemptResult({
        status: accepted.status,
        body: accepted.body,
      }).stage,
    ).toBe('consentRequired');
    expect(
      (
        await e2e.app
          .get(PasskeyStore)
          .findByCredentialId(authenticator.credentialId)
      )?.counter,
    ).toBe(4);
    await request(e2e.httpServer)
      .post(path(attempt.attemptId, 'passkey/verify'))
      .set('X-Native-Attempt', attempt.attemptSecret)
      .send({ response: proof })
      .expect(409);
  });

  it('rejects signed assertions for a wrong origin, RP, and superseded challenge', async () => {
    const userId = await e2e.state.accounts.accountIdFor(SEED_USER.email);
    if (!userId) throw new Error('seed account missing');
    const key = createSoftwareAuthenticator(randomBytes(32));
    await e2e.state.auth.storePasskey(SEED_USER.email, {
      credentialId: key.credentialId,
      publicKey: key.cosePublicKey,
      counter: 3,
      transports: ['internal'],
      deviceType: 'singleDevice',
      backedUp: false,
      name: 'Native fixture',
      lastUsedAt: null,
      rpId: RP_ID,
    });
    const attempt = await start();
    const issue = async () => {
      const response = await request(e2e.httpServer)
        .post(path(attempt.attemptId, 'passkey/options'))
        .set('X-Native-Attempt', attempt.attemptSecret)
        .expect(201);
      return unwrapNativePasskeyOptions({
        status: response.status,
        body: response.body,
      }).challenge;
    };
    const firstChallenge = await issue();
    const currentChallenge = await issue();
    const verify = async (
      challenge: string,
      origin: string,
      rpId: string,
      counter: number,
    ) => {
      return request(e2e.httpServer)
        .post(path(attempt.attemptId, 'passkey/verify'))
        .set('X-Native-Attempt', attempt.attemptSecret)
        .send({
          response: assertion(key, userId, {
            challenge,
            origin,
            rpId,
            counter,
            flags: FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
          }),
        });
    };
    expect((await verify(firstChallenge, ORIGIN, RP_ID, 4)).status).toBe(409);
    expect(
      (await verify(currentChallenge, 'https://other.test', RP_ID, 4)).status,
    ).toBe(409);
    expect(
      (await verify(currentChallenge, ORIGIN, 'other.test', 4)).status,
    ).toBe(409);
    expect((await verify(currentChallenge, ORIGIN, RP_ID, 4)).status).toBe(201);
    const next = await start();
    const nextOptions = await request(e2e.httpServer)
      .post(path(next.attemptId, 'passkey/options'))
      .set('X-Native-Attempt', next.attemptSecret)
      .expect(201);
    const nextChallenge = unwrapNativePasskeyOptions({
      status: nextOptions.status,
      body: nextOptions.body,
    }).challenge;
    await request(e2e.httpServer)
      .post(path(next.attemptId, 'passkey/verify'))
      .set('X-Native-Attempt', next.attemptSecret)
      .send({
        response: assertion(key, userId, {
          challenge: nextChallenge,
          origin: ORIGIN,
          rpId: RP_ID,
          counter: 4,
          flags: FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
        }),
      })
      .expect(409);
  });

  it('spends a recovery code with the native attempt and refuses its replay', async () => {
    const { recoveryCodes } = await enrol();
    const first = await start();
    const held = await password(first);
    expect(
      unwrapNativeAttemptResult({ status: held.status, body: held.body }).stage,
    ).toBe('secondFactorRequired');
    const accepted = await request(e2e.httpServer)
      .post(path(first.attemptId, 'second-factor'))
      .set('X-Native-Attempt', first.attemptSecret)
      .send({ recoveryCode: recoveryCodes[0] })
      .expect(201);
    expect(
      unwrapNativeAttemptResult({
        status: accepted.status,
        body: accepted.body,
      }).stage,
    ).toBe('consentRequired');
    const second = await start();
    expect((await password(second)).status).toBe(201);
    await request(e2e.httpServer)
      .post(path(second.attemptId, 'second-factor'))
      .set('X-Native-Attempt', second.attemptSecret)
      .send({ recoveryCode: recoveryCodes[0] })
      .expect(401);
    const resumed = await request(e2e.httpServer)
      .get(`/api/auth/native/attempts/${first.attemptId}`)
      .set('X-Native-Attempt', first.attemptSecret)
      .expect(200);
    expect(
      unwrapNativeAttemptResult({ status: resumed.status, body: resumed.body })
        .stage,
    ).toBe('consentRequired');
  });
});
