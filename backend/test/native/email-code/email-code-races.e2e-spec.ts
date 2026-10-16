import { TEST_NOW } from '../../utils/frozen-clock';
import type { E2eApp } from '../../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import {
  postLifecycle,
  startLifecycleAttempt,
  storedAttempt,
} from '../lifecycle/native-lifecycle.fixtures';
import {
  bootEmailCodeApp,
  lastSignInMail,
  requestCode,
  setEmailCode,
  storedCode,
  verifyCode,
} from './email-code.fixtures';

const MINE = 'racer@example.test';

describe('native email code races (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootEmailCodeApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    setEmailCode(e2e, true);
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  async function mailedAttempt() {
    const attempt = await startLifecycleAttempt(e2e, 'signIn');
    await requestCode(e2e, attempt, MINE).expect(200);
    return { attempt, ...(await lastSignInMail(e2e)) };
  }

  it('lets one of two right verifies at once finish the attempt', async () => {
    const { attempt, code } = await mailedAttempt();
    const responses = await Promise.all([
      verifyCode(e2e, attempt, code),
      verifyCode(e2e, attempt, code),
    ]);
    const statuses = responses.map(({ status }) => status).sort();
    expect(statuses[0]).toBe(200);
    expect([400, 409]).toContain(statuses[1]);
    expect((await storedCode(e2e, attempt))?.spentAt).toEqual(TEST_NOW);
    expect(await e2e.state.accounts.accountIdFor(MINE)).not.toBeNull();
  });

  it('lets one of the link and the code spent at once finish the attempt', async () => {
    const { attempt, code, link } = await mailedAttempt();
    const fragment = new URLSearchParams(link?.hash.slice(1));
    const responses = await Promise.all([
      verifyCode(e2e, attempt, code),
      postLifecycle(e2e, attempt, 'email-link/verify', {
        token: fragment.get('native_email_token'),
        state: fragment.get('state'),
      }),
    ]);
    const statuses = responses.map(({ status }) => status).sort();
    expect(statuses[0]).toBe(200);
    expect([400, 409]).toContain(statuses[1]);
    const finished = await storedAttempt(e2e, attempt);
    expect(finished.phase).toBe('consentRequired');
    const factor = finished.details.verifiedAccount?.firstFactor;
    expect((await storedCode(e2e, attempt))?.spentAt).toEqual(
      factor === 'emailCode' ? TEST_NOW : null,
    );
  });
});
