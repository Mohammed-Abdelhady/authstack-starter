import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { SEED_USER } from '../constants/seed-users';
import { bootE2eApp, loginAs, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { createNativeApplication } from '../utils/native/native-authorize.fixtures';
import { signInNative } from '../utils/sdk/sdk-transport';
import {
  FLAG_USER_PRESENT,
  attestationCredential,
  createSoftwareAuthenticator,
} from '../../src/auth/passkeys/services/software-authenticator.harness-spec';
import { E2E_CLIENT_URL } from '../utils/e2e-app';

const OPTIONS = '/api/auth/passkeys/register/options';
const VERIFY = '/api/auth/passkeys/register/verify';
const CHALLENGE_COOKIE = 'pk_challenge';
const FIXTURE_HOST = '127.0.0.1';
/** A credential the right shape for the route and wrong for the authenticator. */
const UNSIGNED_CREDENTIAL = {
  response: {
    id: 'ZTJlLWNyZWRlbnRpYWw',
    rawId: 'ZTJlLWNyZWRlbnRpYWw',
    response: {},
    clientExtensionResults: {},
    type: 'public-key',
  },
};

interface Answered {
  status: number;
  body: unknown;
  headers: Record<string, unknown>;
}

interface Refusal {
  status: number;
  code: string;
  required?: unknown;
}

function refusalOf(answer: Answered): Refusal {
  const { error } = answer.body as {
    error: { code: string; details?: { required?: unknown } };
  };
  return {
    status: answer.status,
    code: error.code,
    ...(error.details?.required === undefined
      ? {}
      : { required: error.details.required }),
  };
}

/** The challenge cookie an options answer set, as the browser would store it. */
function challengeCookieOf(answer: Answered): string {
  const set = answer.headers['set-cookie'];
  const cookies = Array.isArray(set) ? set.map(String) : [];
  const cookie = cookies.find((value) =>
    value.startsWith(`${CHALLENGE_COOKIE}=`),
  );
  if (!cookie) throw new Error('the answer set no challenge cookie');
  return cookie;
}

describe('adding a passkey asks who is there again (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    await e2e.state.auth.removeEveryPasskey();
    e2e.app.get(ConfigService).set('auth.nativeEnabled', true);
    await createNativeApplication(e2e);
  });

  it('asks a signed-in browser for its password before it hands out options', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);

    const bare = await browser.post(OPTIONS).send({});
    const wrong = await browser
      .post(OPTIONS)
      .send({ password: 'NotThePassword1!' });
    const right = await browser
      .post(OPTIONS)
      .send({ password: SEED_USER.password });

    expect(refusalOf(bare)).toEqual({
      status: 401,
      code: 'REAUTH_REQUIRED',
      required: 'password',
    });
    expect(bare.headers['set-cookie']).toBeUndefined();
    expect(refusalOf(wrong)).toEqual({
      status: 400,
      code: 'INVALID_CURRENT_PASSWORD',
    });
    expect(right.status).toBe(200);
    expect(
      (right.body as { data: { challenge: unknown } }).data.challenge,
    ).toEqual(expect.any(String));
    expect(challengeCookieOf(right)).toContain('HttpOnly');
  });

  it('asks a mobile access token for the same proof', async () => {
    const { tokens } = await signInNative(e2e);
    const ask = (body: Record<string, string>) =>
      request(e2e.httpServer)
        .post(OPTIONS)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send(body);

    const bare = await ask({});
    const wrong = await ask({ password: 'NotThePassword1!' });
    const right = await ask({ password: SEED_USER.password });

    expect(refusalOf(bare)).toEqual({
      status: 401,
      code: 'REAUTH_REQUIRED',
      required: 'password',
    });
    expect(refusalOf(wrong)).toEqual({
      status: 400,
      code: 'INVALID_CURRENT_PASSWORD',
    });
    expect(right.status).toBe(200);
  });

  it('takes the challenge from the session that gave its password and from no other', async () => {
    const proved = await loginAs(e2e.httpServer, SEED_USER);
    const other = await loginAs(e2e.httpServer, SEED_USER);
    const forOther = await proved
      .post(OPTIONS)
      .send({ password: SEED_USER.password });
    // Another session of the same account sends the cookie the first one earned.
    other.jar.setCookie(challengeCookieOf(forOther), FIXTURE_HOST, '/');

    const fromOther = await other.post(VERIFY).send(UNSIGNED_CREDENTIAL);
    await proved.post(OPTIONS).send({ password: SEED_USER.password });
    const fromProved = await proved.post(VERIFY).send(UNSIGNED_CREDENTIAL);

    expect(refusalOf(fromOther)).toEqual({
      status: 401,
      code: 'PASSKEY_CHALLENGE_INVALID',
    });
    // Its own session gets past the challenge and fails on the credential.
    expect(refusalOf(fromProved)).toEqual({
      status: 401,
      code: 'PASSKEY_VERIFICATION_FAILED',
    });
    expect(await e2e.state.auth.countPasskeys()).toBe(0);
  });

  it('sends one notice only after a real authenticator registration succeeds', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const options = await browser
      .post(OPTIONS)
      .send({ password: SEED_USER.password })
      .expect(200);
    const challenge = (options.body as { data: { challenge: string } }).data
      .challenge;
    const authenticator = createSoftwareAuthenticator(
      Buffer.from('notice-passkey-credential'),
    );
    const credential = attestationCredential(authenticator, {
      rpId: new URL(E2E_CLIENT_URL).hostname,
      origin: E2E_CLIENT_URL,
      challenge,
      flags: FLAG_USER_PRESENT,
      counter: 0,
    });

    await browser.post(VERIFY).send({ response: credential }).expect(200);
    expect(await e2e.state.auth.countPasskeys()).toBe(1);
    const mail = await e2e.captureMail();
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({
      to: SEED_USER.email,
      subject: 'A passkey was added',
    });
    expect(JSON.stringify(mail[0])).not.toContain(authenticator.credentialId);
    expect(JSON.stringify(mail[0])).not.toContain(challenge);

    await browser.post(VERIFY).send({ response: credential }).expect(401);
    expect(await e2e.state.auth.countPasskeys()).toBe(1);
    expect(await e2e.captureMail()).toHaveLength(1);
  });

  it('refuses the eleventh request for options of one client in fifteen minutes, right password or not', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);

    const guesses: Refusal[] = [];
    for (let guess = 0; guess < 10; guess += 1) {
      guesses.push(
        refusalOf(
          await browser.post(OPTIONS).send({ password: 'NotThePassword1!' }),
        ),
      );
    }
    const eleventh = await browser
      .post(OPTIONS)
      .send({ password: SEED_USER.password });

    expect(guesses).toEqual(
      Array.from({ length: 10 }, () => ({
        status: 400,
        code: 'INVALID_CURRENT_PASSWORD',
      })),
    );
    expect(refusalOf(eleventh)).toEqual({
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });
});
