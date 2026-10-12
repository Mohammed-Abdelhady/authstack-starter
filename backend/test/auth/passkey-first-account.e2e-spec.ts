import { ConfigService } from '@nestjs/config';
import { unwrapIdentityBody } from '@app/sdk';
import type { Response } from 'supertest';
import {
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
  assertionCredential,
  attestationCredential,
  createSoftwareAuthenticator,
} from '../../src/auth/passkeys/services/software-authenticator.harness-spec';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import {
  bootE2eApp,
  browserAgent,
  E2E_CLIENT_URL,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const ACCOUNT = {
  email: 'first-passkey-account@example.test',
  password: 'FirstPasskey-123',
};
const REGISTER = '/api/auth/passkeys/register';
const LOGIN = '/api/auth/passkeys/login';

function errorCode(answer: Response): string | undefined {
  return (answer.body as { error?: { code?: string } }).error?.code;
}

async function withProof(
  browser: TestAgent,
  path: string,
  body: object,
): Promise<Response> {
  const proof = await browser.get('/api/auth/browser-proof').expect(200);
  const token = (proof.body as { data: { token: string } }).data.token;
  return browser.post(path).set(CSRF_HEADER, token).send(body);
}

function challenge(answer: Response): { challenge: string; rpId: string } {
  const data = (answer.body as { data: { challenge: string } }).data;
  return { challenge: data.challenge, rpId: new URL(E2E_CLIENT_URL).hostname };
}

describe('provisioning the first account before passkeys-only sign-in (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp(0, { seedUsers: false });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    e2e.app.get(ConfigService).set('passkeys.enabled', true);
  });

  it('cannot create or enroll a first account with only passkeys enabled', async () => {
    e2e.app.get(ConfigService).set('auth.passwordEnabled', false);
    const browser = await browserAgent(e2e.httpServer);
    const registration = await browser
      .post('/api/auth/register')
      .send({ email: ACCOUNT.email });
    const enrolment = await browser
      .post(`${REGISTER}/options`)
      .send({ password: ACCOUNT.password });
    const options = await withProof(browser, `${LOGIN}/options`, {});
    expect(options.status).toBe(200);
    const authenticator = createSoftwareAuthenticator(
      Buffer.from('first-account-unowned-key'),
    );
    const assertion = assertionCredential(authenticator, {
      ...challenge(options),
      origin: E2E_CLIENT_URL,
      flags: FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
      counter: 1,
    });
    const signIn = await withProof(browser, `${LOGIN}/verify`, {
      response: assertion,
    });

    expect({
      registration: [registration.status, errorCode(registration)],
      enrolment: enrolment.status,
      signIn: [signIn.status, errorCode(signIn)],
      account: await e2e.state.accounts.accountIdFor(ACCOUNT.email),
      passkeys: await e2e.state.auth.countPasskeys(),
      sessions: await e2e.state.sessions.countSessions(),
    }).toEqual({
      registration: [404, ErrorCode.FEATURE_DISABLED],
      enrolment: 401,
      signIn: [401, ErrorCode.PASSKEY_VERIFICATION_FAILED],
      account: null,
      passkeys: 0,
      sessions: 0,
    });
  });

  it('enrolls through password bootstrap, then signs in with only that passkey', async () => {
    e2e.app.get(ConfigService).set('auth.passwordEnabled', true);
    const registrant = await browserAgent(e2e.httpServer);
    await withProof(registrant, '/api/auth/register', {
      email: ACCOUNT.email,
    }).then((answer) => expect(answer.status).toBe(200));
    const code = await e2e.mailedCode();
    const activation = await withProof(registrant, '/api/auth/activate', {
      email: ACCOUNT.email,
      code,
      password: ACCOUNT.password,
      name: 'First Account',
    });
    expect(activation.status).toBe(200);
    const stored = await e2e.state.accounts.accountWithAddress(ACCOUNT.email);
    expect(stored?.isVerified).toBe(true);

    const owner = await loginAs(e2e.httpServer, ACCOUNT);
    const options = await owner
      .post(`${REGISTER}/options`)
      .send({ password: ACCOUNT.password })
      .expect(200);
    const authenticator = createSoftwareAuthenticator(
      Buffer.from('first-account-enrolled-key'),
    );
    const attestation = attestationCredential(authenticator, {
      ...challenge(options),
      origin: E2E_CLIENT_URL,
      flags: FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
      counter: 0,
    });
    await owner
      .post(`${REGISTER}/verify`)
      .send({ response: attestation })
      .expect(200);
    expect(await e2e.state.auth.countPasskeys()).toBe(1);

    e2e.app.get(ConfigService).set('auth.passwordEnabled', false);
    const passwordBrowser = await browserAgent(e2e.httpServer);
    const closedLogin = await withProof(
      passwordBrowser,
      '/api/auth/login',
      ACCOUNT,
    );
    const closedRegister = await withProof(
      passwordBrowser,
      '/api/auth/register',
      {
        email: 'another@example.test',
      },
    );
    expect([closedLogin.status, errorCode(closedLogin)]).toEqual([
      404,
      ErrorCode.FEATURE_DISABLED,
    ]);
    expect([closedRegister.status, errorCode(closedRegister)]).toEqual([
      404,
      ErrorCode.FEATURE_DISABLED,
    ]);

    const returning = await browserAgent(e2e.httpServer);
    const signInOptions = await withProof(returning, `${LOGIN}/options`, {});
    expect(signInOptions.status).toBe(200);
    const assertion = assertionCredential(authenticator, {
      ...challenge(signInOptions),
      origin: E2E_CLIENT_URL,
      flags: FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
      counter: 1,
    });
    const signedIn = await withProof(returning, `${LOGIN}/verify`, {
      response: assertion,
    });
    expect(signedIn.status).toBe(200);
    const identity = unwrapIdentityBody(
      (await returning.get('/api/auth/identity').expect(200)).body,
    );
    expect(
      (signedIn.body as { data: { requiresTwoFactor: boolean } }).data
        .requiresTwoFactor,
    ).toBe(false);
    expect(identity.authenticated).toBe(true);
    if (!identity.authenticated)
      throw new Error('Passkey did not create a session');
    expect(identity.user.id).toBe(stored?._id);
    expect(identity.user.email).toBe(ACCOUNT.email);
    expect(
      await e2e.state.accounts.accountIdFor('another@example.test'),
    ).toBeNull();
  });
});
