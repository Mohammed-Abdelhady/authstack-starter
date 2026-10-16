import { createHash } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { applicationSecret } from '../../../src/session/utils/hashing/application-secret';
import { NATIVE_CLIENT_ID } from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { AccountProfileStore } from '../../../src/user/stores/account-profile.store';
import {
  MAIL_COUNTER_PURPOSE,
  MAILED_CODE_LIMIT_PER_ADDRESS,
  PENDING_PURPOSE,
} from '../../../src/auth/constants/registration';
import { NATIVE_ATTEMPT_PHASE } from '../../../src/auth/native/constants/native-attempt';
import {
  bootNativeLifecycleApp,
  parseLifecycleResult,
  postLifecycle,
  startLifecycleAttempt,
  storedAttempt,
  type StartedLifecycleAttempt,
} from './native-lifecycle.fixtures';
import { TEST_NOW } from '../../utils/frozen-clock';
import { describeNativeRegistrationGate } from './native-registration-gate.harness-spec';
import type { E2eApp } from '../../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';

const EMAIL = 'native-registration@example.test';
const PASSWORD = 'NativePassword123!';
const NAME = 'Native Registered';

describeNativeRegistrationGate();

describe('native registration lifecycle contract', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootNativeLifecycleApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  function requestCode(attempt: StartedLifecycleAttempt, email: string) {
    return postLifecycle(e2e, attempt, 'register', { email });
  }

  function activate(
    attempt: StartedLifecycleAttempt,
    email: string,
    code: string,
  ) {
    return postLifecycle(e2e, attempt, 'activate', {
      email,
      code,
      password: PASSWORD,
      name: NAME,
    });
  }

  it('binds an activation attempt to the stored mailed generation and commits the account without a session', async () => {
    const attempt = await startLifecycleAttempt(e2e, 'registration');
    const requested = await requestCode(attempt, EMAIL).expect(200);
    expect(parseLifecycleResult(requested)).toMatchObject({
      stage: 'registrationCodeRequired',
      email: EMAIL,
      activationCompleted: false,
    });
    const code = await e2e.mailedCode();
    const pending = await e2e.state.auth.pendingRegistrationFor(EMAIL);
    if (!pending) throw new Error('registration code was not persisted');
    const stored = await storedAttempt(e2e, attempt);
    const generationHash = createHash('sha256')
      .update(pending.hashedCode)
      .digest('hex');
    expect(stored.details.emailCodeGenerationHash).toBe(generationHash);
    expect(stored.details.emailCodeGenerationHash).not.toBe(code);
    expect(
      await bcrypt.compare(
        applicationSecret(code, NATIVE_CLIENT_ID),
        pending.hashedCode,
      ),
    ).toBe(true);

    const activated = await activate(attempt, EMAIL, code).expect(200);
    expect(parseLifecycleResult(activated)).toMatchObject({
      stage: 'consentRequired',
      activationCompleted: true,
      account: { email: EMAIL },
    });
    expect(activated.headers['set-cookie']).toBeUndefined();
    expect(await e2e.state.accounts.accountIdFor(EMAIL)).not.toBeNull();
    expect(await e2e.state.auth.countPendingRegistrations(EMAIL)).toBe(0);
    const completed = await storedAttempt(e2e, attempt);
    expect(completed.details.activationCompleted).toBe(true);
    expect(completed.details.emailCodeGenerationHash).toBeNull();
  });

  it('rejects a code rotated for another attempt and lets only the current generation activate', async () => {
    const first = await startLifecycleAttempt(e2e, 'registration');
    await requestCode(first, EMAIL).expect(200);
    await e2e.captureMail();
    const firstAttempt = await storedAttempt(e2e, first);

    const second = await startLifecycleAttempt(e2e, 'registration');
    await requestCode(second, EMAIL).expect(200);
    await e2e.captureMail();
    const secondCode = await e2e.mailedCode();
    const secondAttempt = await storedAttempt(e2e, second);
    expect(secondAttempt.details.emailCodeGenerationHash).not.toBe(
      firstAttempt.details.emailCodeGenerationHash,
    );
    const pending = await e2e.state.auth.pendingRegistrationFor(EMAIL);
    if (!pending) throw new Error('registration code was not persisted');
    expect(
      await bcrypt.compare(
        applicationSecret(secondCode, NATIVE_CLIENT_ID),
        pending.hashedCode,
      ),
    ).toBe(true);

    const stale = await activate(first, EMAIL, secondCode).expect(400);
    expect(stale.body.error.code).toBe(ErrorCode.ACTIVATION_CODE_INVALID);
    expect(await e2e.state.accounts.accountIdFor(EMAIL)).toBeNull();
    const success = await activate(second, EMAIL, secondCode).expect(200);
    expect(parseLifecycleResult(success).stage).toBe('consentRequired');
    expect(await e2e.state.accounts.accountIdFor(EMAIL)).not.toBeNull();
  });

  it('keeps taken-address and over-cap requests generic and blocks recovery-flow reuse', async () => {
    const takenEmail = 'native-registration-taken@example.test';
    const deletedEmail = 'native-registration-deleted@example.test';
    await e2e.state.accounts.createAccount({
      email: takenEmail,
      name: 'Taken',
      isVerified: true,
    });
    await e2e.state.accounts.createAccount({
      email: deletedEmail,
      name: 'Deleted',
      isDeleted: true,
    });
    const takenAttempt = await startLifecycleAttempt(e2e, 'registration');
    const missingAttempt = await startLifecycleAttempt(e2e, 'registration');
    const deletedAttempt = await startLifecycleAttempt(e2e, 'registration');
    const taken = await requestCode(takenAttempt, takenEmail).expect(200);
    const missing = await requestCode(
      missingAttempt,
      'native-registration-missing@example.test',
    ).expect(200);
    const deleted = await requestCode(deletedAttempt, deletedEmail).expect(200);
    expect(parseLifecycleResult(taken)).toMatchObject({
      stage: 'registrationCodeRequired',
      email: takenEmail,
    });
    expect(parseLifecycleResult(missing)).toMatchObject({
      stage: 'registrationCodeRequired',
      email: 'native-registration-missing@example.test',
    });
    expect(parseLifecycleResult(deleted)).toMatchObject({
      stage: 'registrationCodeRequired',
      email: deletedEmail,
    });
    expect(
      (await storedAttempt(e2e, takenAttempt)).details.emailCodeGenerationHash,
    ).toBeNull();
    expect(
      (await storedAttempt(e2e, deletedAttempt)).details
        .emailCodeGenerationHash,
    ).toBeNull();
    expect(
      (await storedAttempt(e2e, missingAttempt)).details
        .emailCodeGenerationHash,
    ).not.toBeNull();

    const capEmail = 'native-registration-cap@example.test';
    await e2e.state.auth.storeMailCounter({
      email: capEmail,
      purpose: MAIL_COUNTER_PURPOSE.SIGNUP,
      mailedCodes: MAILED_CODE_LIMIT_PER_ADDRESS,
    });
    const capAttempt = await startLifecycleAttempt(e2e, 'registration');
    const capped = await requestCode(capAttempt, capEmail).expect(200);
    expect(parseLifecycleResult(capped).stage).toBe('registrationCodeRequired');
    expect(
      (await storedAttempt(e2e, capAttempt)).details.emailCodeGenerationHash,
    ).toBeNull();

    const wrongFlow = await startLifecycleAttempt(e2e, 'recovery');
    await postLifecycle(e2e, wrongFlow, 'register', { email: EMAIL }).expect(
      409,
    );
    expect(
      await e2e.state.auth.countPendingRegistrations(
        EMAIL,
        PENDING_PURPOSE.SIGNUP,
      ),
    ).toBe(0);
  });

  it('rejects malformed email objects as validation errors', async () => {
    const attempt = await startLifecycleAttempt(e2e, 'registration');
    const response = await postLifecycle(e2e, attempt, 'register', {
      email: { bad: true },
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect((await storedAttempt(e2e, attempt)).phase).toBe(
      NATIVE_ATTEMPT_PHASE.FIRST_FACTOR_REQUIRED,
    );
  });

  it('persists a 100 character supplementary name and passes the real response into the native SDK', async () => {
    const name = '\u{10400}'.repeat(100);
    const attempt = await startLifecycleAttempt(e2e, 'registration');
    await requestCode(attempt, EMAIL).expect(200);
    const code = await e2e.mailedCode();
    const activated = await postLifecycle(e2e, attempt, 'activate', {
      email: EMAIL,
      code,
      password: PASSWORD,
      name,
    }).expect(200);
    expect(parseLifecycleResult(activated)).toMatchObject({
      stage: 'consentRequired',
      account: { name },
    });
    const id = await e2e.state.accounts.accountIdFor(EMAIL);
    if (!id) throw new Error('activated account was not persisted');
    expect((await e2e.app.get(AccountProfileStore).findAccount(id))?.name).toBe(
      name,
    );
  });
});
