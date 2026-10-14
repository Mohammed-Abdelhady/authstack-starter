// feature:email-password:start
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { ACCOUNT_CREATION_METHOD } from '../../src/auth/constants/account-creation';
import {
  MAIL_COUNTER_PURPOSE,
  PENDING_PURPOSE,
} from '../../src/auth/constants/registration';
import { WEB_CLIENT_ID } from '../../src/session/constants/client-ids';
import { UnitOfWork } from '../../src/common/persistence/unit-of-work';
import { bootE2eApp, browserAgent, type E2eApp } from '../utils/e2e-app';
import {
  installAccountCreationPolicy,
  type SwitchableAccountCreationPolicy,
} from '../utils/account-creation-policy';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const EMAIL = 'creation-gate@example.test';
const PASSWORD = 'Password123!';

export function describePasswordCreationGate(): void {
  describe('browser password account creation policy', () => {
    let e2e: E2eApp;
    let policy: SwitchableAccountCreationPolicy;

    beforeAll(async () => {
      e2e = await bootE2eApp();
    }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
    beforeEach(async () => {
      e2e.clock.set(TEST_NOW);
      await e2e.reset();
      policy = installAccountCreationPolicy(e2e.app);
    });
    afterEach(() => jest.restoreAllMocks());
    afterAll(async () => {
      await e2e?.close();
    }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

    async function requestCode() {
      const browser = await browserAgent(e2e.httpServer);
      return browser.post('/api/auth/register').send({ email: EMAIL });
    }

    async function activate(code: string) {
      const browser = await browserAgent(e2e.httpServer);
      return browser.post('/api/auth/activate').send({
        email: EMAIL,
        code,
        password: PASSWORD,
        name: 'Gate account',
      });
    }

    it('asks once in the request transaction and once in a distinct creation transaction', async () => {
      expect((await requestCode()).status).toBe(200);
      expect(policy.calls).toHaveLength(1);
      expect(policy.calls[0].request).toEqual({
        application: WEB_CLIENT_ID,
        method: ACCOUNT_CREATION_METHOD.PASSWORD,
      });
      const requestUnit = policy.calls[0].unitOfWork;
      expect(requestUnit).toBeInstanceOf(UnitOfWork);
      policy.calls.length = 0;

      expect((await activate(await e2e.mailedCode())).status).toBe(200);

      expect(policy.calls).toHaveLength(1);
      expect(policy.calls[0].request).toEqual({
        application: WEB_CLIENT_ID,
        method: ACCOUNT_CREATION_METHOD.PASSWORD,
      });
      expect(policy.calls[0].unitOfWork).toBeInstanceOf(UnitOfWork);
      expect(policy.calls[0].unitOfWork).not.toBe(requestUnit);
      expect(await e2e.state.auth.countAccountsWithAddress(EMAIL)).toBe(1);
      expect(await e2e.state.auth.countPendingRegistrations(EMAIL)).toBe(0);
    });

    it('refuses a code request before persisting a pending code or sending mail', async () => {
      policy.refused = true;

      const refused = await requestCode();

      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({
        success: false,
        error: { code: ErrorCode.ACCOUNT_CREATION_REFUSED },
      });
      expect(await e2e.state.auth.countPendingRegistrations(EMAIL)).toBe(0);
      expect(await e2e.state.accounts.accountIdFor(EMAIL)).toBeNull();
      expect(await e2e.captureMail()).toEqual([]);
    });

    it('refuses resend before rotating the generation, recording a mail counter or sending mail', async () => {
      expect((await requestCode()).status).toBe(200);
      const pending = await e2e.state.auth.pendingRegistrationFor(EMAIL);
      if (!pending) throw new Error('request did not persist the pending code');
      const generation = pending.hashedCode;
      expect(generation).not.toBe('');
      expect(pending).toMatchObject({
        purpose: PENDING_PURPOSE.SIGNUP,
        attempts: 0,
      });
      expect(
        await e2e.state.auth.mailCounterFor(EMAIL, MAIL_COUNTER_PURPOSE.SIGNUP),
      ).toEqual({ mailedCodes: 1 });
      expect(await e2e.captureMail()).toHaveLength(1);
      policy.calls.length = 0;
      policy.refused = true;

      const browser = await browserAgent(e2e.httpServer);
      const refused = await browser
        .post('/api/auth/resend-activation')
        .send({ email: EMAIL });

      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({
        success: false,
        error: { code: ErrorCode.ACCOUNT_CREATION_REFUSED },
      });
      expect(policy.calls).toHaveLength(1);
      expect(policy.calls[0].request).toEqual({
        application: WEB_CLIENT_ID,
        method: ACCOUNT_CREATION_METHOD.PASSWORD,
      });
      expect(policy.calls[0].unitOfWork).toBeInstanceOf(UnitOfWork);
      expect(await e2e.state.auth.pendingRegistrationFor(EMAIL)).toMatchObject({
        hashedCode: generation,
        purpose: PENDING_PURPOSE.SIGNUP,
        attempts: 0,
      });
      expect(
        await e2e.state.auth.mailCounterFor(EMAIL, MAIL_COUNTER_PURPOSE.SIGNUP),
      ).toEqual({ mailedCodes: 1 });
      expect(await e2e.captureMail()).toHaveLength(1);
    });

    it('keeps a mailed code after activation is refused and allows a later attempt', async () => {
      expect((await requestCode()).status).toBe(200);
      const code = await e2e.mailedCode();
      const pending = await e2e.state.auth.pendingRegistrationFor(EMAIL);
      if (!pending) throw new Error('request did not persist the pending code');
      policy.calls.length = 0;
      policy.refused = true;

      const refused = await activate(code);

      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe(ErrorCode.ACCOUNT_CREATION_REFUSED);
      expect(policy.calls).toHaveLength(1);
      expect(refused.headers['set-cookie']).toBeUndefined();
      expect(await e2e.state.accounts.accountIdFor(EMAIL)).toBeNull();
      expect(await e2e.state.auth.pendingRegistrationFor(EMAIL)).toMatchObject({
        hashedCode: pending.hashedCode,
        purpose: pending.purpose,
      });
      expect(await e2e.state.sessions.countSessions()).toBe(0);
      policy.refused = false;
      expect((await activate(code)).status).toBe(200);
      expect(await e2e.state.auth.countAccountsWithAddress(EMAIL)).toBe(1);
    });

    it('asks once per fresh transaction after a retryable abort and stores one account', async () => {
      expect((await requestCode()).status).toBe(200);
      const code = await e2e.mailedCode();
      policy.calls.length = 0;
      const assertMayCreate = policy.assertMayCreate.bind(policy);
      let aborted = false;
      jest
        .spyOn(policy, 'assertMayCreate')
        .mockImplementation(async (request, work) => {
          await assertMayCreate(request, work);
          if (!aborted) {
            aborted = true;
            throw Object.assign(new Error('Retryable creation check abort'), {
              code: '40001',
              errorLabels: ['TransientTransactionError'],
            });
          }
        });

      expect((await activate(code)).status).toBe(200);

      expect(policy.calls).toHaveLength(2);
      expect(policy.calls.map(({ request }) => request)).toEqual([
        {
          application: WEB_CLIENT_ID,
          method: ACCOUNT_CREATION_METHOD.PASSWORD,
        },
        {
          application: WEB_CLIENT_ID,
          method: ACCOUNT_CREATION_METHOD.PASSWORD,
        },
      ]);
      expect(policy.calls[0].unitOfWork).not.toBe(policy.calls[1].unitOfWork);
      expect(await e2e.state.auth.countAccountsWithAddress(EMAIL)).toBe(1);
      expect(await e2e.state.auth.countPendingRegistrations(EMAIL)).toBe(0);
    });
  });
}
// feature:email-password:end
