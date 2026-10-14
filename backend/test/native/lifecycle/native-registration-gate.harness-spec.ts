// feature:email-password:start
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { UnitOfWork } from '../../../src/common/persistence/unit-of-work';
import { ACCOUNT_CREATION_METHOD } from '../../../src/auth/constants/account-creation';
import { NATIVE_CLIENT_ID } from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import type { E2eApp } from '../../utils/e2e-app';
import {
  installAccountCreationPolicy,
  type SwitchableAccountCreationPolicy,
} from '../../utils/account-creation-policy';
import { TEST_NOW } from '../../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import {
  bootNativeLifecycleApp,
  postLifecycle,
  startLifecycleAttempt,
  storedAttempt,
  type StartedLifecycleAttempt,
} from './native-lifecycle.fixtures';

const EMAIL = 'native-registration-gate@example.test';

export function describeNativeRegistrationGate(): void {
  describe('native registration account creation policy', () => {
    let e2e: E2eApp;
    let policy: SwitchableAccountCreationPolicy;
    beforeAll(async () => {
      e2e = await bootNativeLifecycleApp();
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

    function activate(attempt: StartedLifecycleAttempt, code: string) {
      return postLifecycle(e2e, attempt, 'activate', {
        email: EMAIL,
        code,
        password: 'NativePassword123!',
        name: 'Native gate account',
      });
    }

    it('checks the attempt client once for each request and creating transaction', async () => {
      const attempt = await startLifecycleAttempt(e2e, 'registration');
      await postLifecycle(e2e, attempt, 'register', { email: EMAIL }).expect(
        200,
      );
      expect(policy.calls).toHaveLength(1);
      expect(policy.calls[0].request).toEqual({
        application: NATIVE_CLIENT_ID,
        method: ACCOUNT_CREATION_METHOD.PASSWORD,
      });
      const requestUnit = policy.calls[0].unitOfWork;
      expect(requestUnit).toBeInstanceOf(UnitOfWork);
      policy.calls.length = 0;

      await activate(attempt, await e2e.mailedCode()).expect(200);

      expect(policy.calls).toHaveLength(1);
      expect(policy.calls[0].request).toEqual({
        application: NATIVE_CLIENT_ID,
        method: ACCOUNT_CREATION_METHOD.PASSWORD,
      });
      expect(policy.calls[0].unitOfWork).toBeInstanceOf(UnitOfWork);
      expect(policy.calls[0].unitOfWork).not.toBe(requestUnit);
      expect(await e2e.state.auth.countAccountsWithAddress(EMAIL)).toBe(1);
    });

    it('refuses before mailing or storing a code and leaves the attempt unadvanced', async () => {
      const attempt = await startLifecycleAttempt(e2e, 'registration');
      const before = await storedAttempt(e2e, attempt);
      policy.refused = true;

      const refused = await postLifecycle(e2e, attempt, 'register', {
        email: EMAIL,
      }).expect(403);

      expect(refused.body.error.code).toBe(ErrorCode.ACCOUNT_CREATION_REFUSED);
      expect(await e2e.state.auth.countPendingRegistrations(EMAIL)).toBe(0);
      expect(await e2e.captureMail()).toEqual([]);
      expect(await e2e.state.accounts.accountIdFor(EMAIL)).toBeNull();
      const after = await storedAttempt(e2e, attempt);
      expect(after.phase).toBe(before.phase);
      expect(after.details).toEqual(before.details);
    });

    it('preserves the pending code and attempt when activation closes after mail', async () => {
      const attempt = await startLifecycleAttempt(e2e, 'registration');
      await postLifecycle(e2e, attempt, 'register', { email: EMAIL }).expect(
        200,
      );
      const code = await e2e.mailedCode();
      const pending = await e2e.state.auth.pendingRegistrationFor(EMAIL);
      if (!pending) throw new Error('registration did not persist a code');
      const before = await storedAttempt(e2e, attempt);
      policy.calls.length = 0;
      policy.refused = true;

      const refused = await activate(attempt, code).expect(403);

      expect(refused.body.error.code).toBe(ErrorCode.ACCOUNT_CREATION_REFUSED);
      expect(policy.calls).toHaveLength(1);
      expect(await e2e.state.accounts.accountIdFor(EMAIL)).toBeNull();
      expect(await e2e.state.auth.pendingRegistrationFor(EMAIL)).toMatchObject({
        hashedCode: pending.hashedCode,
        purpose: pending.purpose,
      });
      const after = await storedAttempt(e2e, attempt);
      expect(after.phase).toBe(before.phase);
      expect(after.details).toEqual(before.details);
      policy.refused = false;
      await activate(attempt, code).expect(200);
      expect(await e2e.state.auth.countAccountsWithAddress(EMAIL)).toBe(1);
    });
  });
}
// feature:email-password:end
