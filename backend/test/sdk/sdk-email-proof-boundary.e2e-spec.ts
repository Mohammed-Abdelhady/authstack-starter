import { ConfigService } from '@nestjs/config'; // feature:email-code
import request from 'supertest'; // feature:passkeys
import { BROWSER_PROOF_PATHS } from '@app/sdk'; // feature:passkeys
import { CSRF_HEADER } from '../../src/session/constants/browser-proof'; // feature:passkeys
// feature:passkeys:start
import {
  issueEnrolment,
  ENROLMENT_ORIGIN,
} from '../utils/session/enrolment-fixtures';
// feature:passkeys:end
// feature:email-code:start
import { browserAgent } from '../utils/e2e-app';
import { browserCookieClient } from '../utils/sdk/staff-browser-client';
// feature:email-code:end
import { SEED_USER } from '../constants/seed-users';
import { NATIVE_CLIENT_ID } from '../utils/native/native-authorize.fixtures';
import {
  apiErrorOf,
  bearerClient,
  publicClient,
  signInNative,
} from '../utils/sdk/sdk-transport';
import {
  bootContractApp,
  resetContractApp,
  type E2eApp,
} from '../utils/sdk/sdk-contract.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const CODE_EXPIRED_MS = 600_000;

function incorrectCode(code: string): string {
  return `${code[0] === '0' ? '1' : '0'}${code.slice(1)}`;
}

describe('full-session emailed proof boundary', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootContractApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    await resetContractApp(e2e);
  });

  it('rejects wrong and expired native proof codes without admitting deletion', async () => {
    const { tokens } = await signInNative(e2e);
    const client = bearerClient(e2e, tokens.accessToken);
    await client.proof.sendCode();
    const code = await e2e.mailedCode();
    expect(
      await apiErrorOf(client.proof.verifyCode({ code: incorrectCode(code) })),
    ).toMatchObject({ status: 401, code: 'ACTIVATION_CODE_INVALID' });
    expect(await apiErrorOf(client.accountDeletion.delete({}))).toMatchObject({
      status: 401,
      code: 'REAUTH_REQUIRED',
    });
    e2e.clock.advance(CODE_EXPIRED_MS);
    const tokensAfterExpiry = await publicClient(e2e).oauth.refresh({
      refreshToken: tokens.refreshToken,
      clientId: NATIVE_CLIENT_ID,
    });
    const current = bearerClient(e2e, tokensAfterExpiry.accessToken);
    expect(await apiErrorOf(current.proof.verifyCode({ code }))).toMatchObject({
      status: 401,
      code: 'ACTIVATION_CODE_INVALID',
    });
    expect(await apiErrorOf(current.accountDeletion.delete({}))).toMatchObject({
      status: 401,
      code: 'REAUTH_REQUIRED',
    });
    expect((await current.profile.get()).email).toBe(SEED_USER.email);
  });

  // feature:passkeys:start
  it('refuses enrollment credentials on both generic email-proof routes', async () => {
    const issued = await issueEnrolment(e2e);
    for (const [path, body] of [
      [BROWSER_PROOF_PATHS.code, {}],
      [BROWSER_PROOF_PATHS.verifyCode, { code: '000000' }],
    ] as const) {
      await request(e2e.httpServer)
        .post(path)
        .set('Origin', ENROLMENT_ORIGIN)
        .set('Cookie', issued.cookie)
        .set(CSRF_HEADER, issued.csrfToken)
        .send(body)
        .expect(403);
    }
    expect(await e2e.captureMail()).toHaveLength(0);
  });
  // feature:passkeys:end

  // feature:email-code:start
  it('cannot use a browser sign-in code as a native action proof', async () => {
    const { tokens } = await signInNative(e2e);
    const native = bearerClient(e2e, tokens.accessToken);
    const config = e2e.app.get(ConfigService);
    config.set('emailCode.enabled', true);
    config.set('auth.web.signIn', { emailCode: true, emailLink: false });
    const anonymous = browserCookieClient(await browserAgent(e2e.httpServer));
    await anonymous.emailCode.request({ email: SEED_USER.email });
    const code = await e2e.mailedCode();
    expect(await apiErrorOf(native.proof.verifyCode({ code }))).toMatchObject({
      status: 401,
      code: 'ACTIVATION_CODE_INVALID',
    });
    expect(await apiErrorOf(native.accountDeletion.delete({}))).toMatchObject({
      status: 401,
      code: 'REAUTH_REQUIRED',
    });
  });
  // feature:email-code:end
});
