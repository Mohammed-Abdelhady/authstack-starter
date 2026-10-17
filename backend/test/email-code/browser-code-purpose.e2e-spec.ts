import crypto from 'crypto';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { VerificationCodeService } from '../../src/auth/services/codes/verification-code.service';
import { PENDING_PURPOSE } from '../../src/auth/constants/registration';
import { SEED_USER } from '../constants/seed-users';
import { browserAgent, loginAs, type E2eApp } from '../utils/e2e-app';
import { CREDENTIAL_PURPOSE } from '../../src/session/constants/credential-purpose';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  askCode,
  bootBrowserCodeApp,
  postCode,
  verifyCode,
} from './browser-code.fixtures';

const PROOF_REQUEST = '/api/auth/proof/code';
const PROOF_VERIFY = '/api/auth/proof/code/verify';
const ADDRESS_VERIFY = '/api/auth/confirm-email-change';

describe('browser email code fixed purpose', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootBrowserCodeApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  afterEach(() => jest.restoreAllMocks());

  it('refuses proof and address codes at sign-in, refuses a sign-in code at both, and preserves the proved session id', async () => {
    const proofActor = await loginAs(e2e.httpServer, SEED_USER);
    const initial = await proofActor.get('/api/auth/csrf').expect(200);
    const csrf: unknown = initial.headers[CSRF_HEADER];
    if (typeof csrf !== 'string') throw new Error('No session CSRF token');
    const identity = await proofActor.get('/api/auth/identity').expect(200);
    const identityBody: unknown = identity.body;
    expect(identityBody).toMatchObject({ data: { authenticated: true } });
    const id = await e2e.state.accounts.accountIdFor(SEED_USER.email);
    if (!id) throw new Error('No seeded account');
    const entropy: { randomInt(min: number, max: number): number } = crypto;
    jest
      .spyOn(entropy, 'randomInt')
      .mockReturnValueOnce(123456)
      .mockReturnValueOnce(234567)
      .mockReturnValueOnce(345678);
    await proofActor.post(PROOF_REQUEST).send({}).expect(200);
    const proofCode = await e2e.mailedCode();
    const browser = await browserAgent(e2e.httpServer);
    const signIn = await askCode(e2e, browser);
    const address = await e2e.app
      .get(VerificationCodeService)
      .createOrUpdatePendingRegistration(
        SEED_USER.email,
        PENDING_PURPOSE.EMAIL_CHANGE,
        { userId: id, addressGeneration: 0 },
      );
    if (!address) throw new Error('No address code');
    expect([proofCode, signIn.mail.code, address.code]).toEqual([
      '123456',
      '234567',
      '345678',
    ]);
    expect((await verifyCode(browser, proofCode)).status).toBe(400);
    expect((await verifyCode(browser, address.code)).status).toBe(400);
    expect(
      (await proofActor.post(PROOF_VERIFY).send({ code: signIn.mail.code }))
        .status,
    ).toBe(401);
    const anonymous = await browserAgent(e2e.httpServer);
    expect(
      (
        await postCode(anonymous, ADDRESS_VERIFY, {
          body: {
            email: SEED_USER.email,
            code: signIn.mail.code,
          },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await postCode(anonymous, ADDRESS_VERIFY, {
          body: {
            email: SEED_USER.email,
            code: proofCode,
          },
        })
      ).status,
    ).toBe(400);
    const count = await e2e.state.sessions.countSessions();
    const sessionId = await e2e.state.sessions.sessionIdWithPurpose(
      CREDENTIAL_PURPOSE.BROWSER_SESSION,
    );
    const proved = await proofActor
      .post(PROOF_VERIFY)
      .send({ code: proofCode });
    expect(proved.status).toBe(200);
    expect(proved.headers['set-cookie']).toBeUndefined();
    expect(await e2e.state.sessions.countSessions()).toBe(count);
    expect(
      await e2e.state.sessions.sessionIdWithPurpose(
        CREDENTIAL_PURPOSE.BROWSER_SESSION,
      ),
    ).toBe(sessionId);
    const after = await proofActor.get('/api/auth/csrf').expect(200);
    expect(after.headers[CSRF_HEADER]).toBe(csrf);
    expect((await verifyCode(browser, signIn.mail.code)).status).toBe(200);
  });
});
