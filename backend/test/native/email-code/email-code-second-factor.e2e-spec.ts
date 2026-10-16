import { SEED_USER } from '../../constants/seed-users';
import {
  applyTwoFactorEnv,
  enrolTwoFactor,
} from '../../utils/auth/two-factor-enrolment';
import { loginAs, type E2eApp } from '../../utils/e2e-app';
import { TEST_NOW } from '../../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import {
  parseLifecycleResult,
  startLifecycleAttempt,
  storedAttempt,
} from '../lifecycle/native-lifecycle.fixtures';
import {
  bootEmailCodeApp,
  lastSignInMail,
  requestCode,
  setEmailCode,
  verifyCode,
} from './email-code.fixtures';

describe('native email code with a second factor (e2e)', () => {
  let e2e: E2eApp;
  let restoreEnv: () => void;

  beforeAll(async () => {
    restoreEnv = applyTwoFactorEnv();
    e2e = await bootEmailCodeApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    setEmailCode(e2e, true);
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
  });

  afterEach(() => jest.useRealTimers());

  afterAll(async () => {
    await e2e?.close();
    restoreEnv();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it('sends an account with a second factor on to it and holds back the code reply', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    await enrolTwoFactor(browser, SEED_USER.password, TEST_NOW);
    const attempt = await startLifecycleAttempt(e2e, 'signIn');
    await requestCode(e2e, attempt, SEED_USER.email).expect(200);
    const { code } = await lastSignInMail(e2e);

    const verified = await verifyCode(e2e, attempt, code).expect(200);

    expect(parseLifecycleResult(verified).stage).toBe('secondFactorRequired');
    const held = await storedAttempt(e2e, attempt);
    expect(held.details.verifiedAccount?.firstFactor).toBe('emailCode');
    expect(held.details.codeReply).toBeNull();
  });
});
