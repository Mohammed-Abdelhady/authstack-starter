import { createHash } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { AccountProfileStore } from '../../../src/user/stores/account-profile.store';
import {
  MAIL_COUNTER_PURPOSE,
  MAILED_CODE_LIMIT_PER_ADDRESS,
} from '../../../src/auth/constants/registration';
import { NATIVE_ATTEMPT_PHASE } from '../../../src/auth/native/constants/native-attempt';
import { CREDENTIAL_PURPOSE } from '../../../src/session/constants/credential-purpose';
import { SEED_USER } from '../../constants/seed-users';
import { browserAgent, loginAs } from '../../utils/e2e-sign-in';
import { TEST_NOW } from '../../utils/frozen-clock';
import type { E2eApp } from '../../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import {
  bootNativeLifecycleApp,
  parseLifecycleResult,
  postLifecycle,
  startLifecycleAttempt,
  storedAttempt,
} from './native-lifecycle.fixtures';

const NEW_PASSWORD = 'NativeResetPassword123!';
const ROTATED_PASSWORD = 'NativeResetPassword456!';

describe('native recovery lifecycle contract', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootNativeLifecycleApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    e2e.app.get(ConfigService).set('auth.nativeApplications', [
      {
        clientId: 'native-app',
        displayName: 'Native lifecycle test client',
        redirectUris: ['myapp://callback'],
        allowedScopes: ['api'],
        signIn: { emailLink: true, registration: true, recovery: true },
      },
    ]);
    await e2e.reset();
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  async function requestCode(email = SEED_USER.email) {
    const attempt = await startLifecycleAttempt(e2e, 'recovery');
    const response = await postLifecycle(e2e, attempt, 'recovery/request', {
      email,
    }).expect(200);
    expect(parseLifecycleResult(response).stage).toBe('recoveryCodeRequired');
    return attempt;
  }

  function confirm(
    attempt: Awaited<ReturnType<typeof requestCode>>,
    code: string,
    newPassword = NEW_PASSWORD,
  ) {
    return postLifecycle(e2e, attempt, 'recovery/confirm', {
      email: SEED_USER.email,
      code,
      newPassword,
    });
  }

  async function accountVersion(): Promise<number> {
    const id = await e2e.state.accounts.accountIdFor(SEED_USER.email);
    if (!id) throw new Error('seed account is missing');
    const account = await e2e.app.get(AccountProfileStore).findAccount(id);
    if (!account) throw new Error('seed account is missing');
    return account.sessionVersion;
  }

  it('binds the request to the stored code generation and invalidates sessions atomically', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const sessionId = await e2e.state.sessions.sessionIdWithPurpose(
      CREDENTIAL_PURPOSE.BROWSER_SESSION,
    );
    if (!sessionId) throw new Error('browser session is missing');
    const beforeVersion = await accountVersion();
    const attempt = await requestCode();
    const code = await e2e.mailedCode();
    const reset = await e2e.state.auth.pendingPasswordResetFor(SEED_USER.email);
    if (!reset) throw new Error('password reset code was not persisted');
    const stored = await storedAttempt(e2e, attempt);
    expect(stored.details.emailCodeGenerationHash).toBe(
      createHash('sha256').update(reset.hashedCode).digest('hex'),
    );
    expect(stored.details.emailCodeGenerationHash).not.toBe(code);
    expect(await bcrypt.compare(code, reset.hashedCode)).toBe(true);

    const completed = await confirm(attempt, code).expect(200);
    expect(parseLifecycleResult(completed)).toMatchObject({
      stage: 'recoveryComplete',
      passwordUpdated: true,
    });
    expect(completed.headers['set-cookie']).toBeUndefined();
    expect(await accountVersion()).toBe(beforeVersion + 1);
    await browser.get('/api/user/profile').expect(401);
    expect(
      await e2e.state.auth.pendingPasswordResetFor(SEED_USER.email),
    ).toBeNull();
  });

  it('rejects a code rotated for a different attempt', async () => {
    const first = await requestCode();
    await e2e.captureMail();
    const firstAttempt = await storedAttempt(e2e, first);
    const second = await requestCode();
    await e2e.captureMail();
    const secondCode = await e2e.mailedCode();
    const secondAttempt = await storedAttempt(e2e, second);
    expect(secondAttempt.details.emailCodeGenerationHash).not.toBe(
      firstAttempt.details.emailCodeGenerationHash,
    );

    const stale = await postLifecycle(e2e, first, 'recovery/confirm', {
      email: SEED_USER.email,
      code: secondCode,
      newPassword: NEW_PASSWORD,
    }).expect(400);
    expect(stale.body.error.code).toBe(ErrorCode.PASSWORD_RESET_CODE_INVALID);
    expect(
      await e2e.state.auth.pendingPasswordResetFor(SEED_USER.email),
    ).not.toBeNull();
    const completed = await confirm(
      second,
      secondCode,
      ROTATED_PASSWORD,
    ).expect(200);
    expect(parseLifecycleResult(completed).stage).toBe('recoveryComplete');
  });

  it('keeps absent, deleted, passwordless, and capped address outcomes generic', async () => {
    const missingEmail = 'native-recovery-missing@example.test';
    const deletedEmail = 'native-recovery-deleted@example.test';
    const passwordlessEmail = 'native-recovery-passwordless@example.test';
    const cappedEmail = 'native-recovery-capped@example.test';
    const missingAttempt = await startLifecycleAttempt(e2e, 'recovery');
    const deletedAttempt = await startLifecycleAttempt(e2e, 'recovery');
    const passwordlessAttempt = await startLifecycleAttempt(e2e, 'recovery');
    const cappedAttempt = await startLifecycleAttempt(e2e, 'recovery');
    await e2e.state.accounts.createAccount({
      email: deletedEmail,
      name: 'Deleted',
      isDeleted: true,
    });
    await e2e.state.accounts.createAccount({
      email: passwordlessEmail,
      name: 'Passwordless',
      isVerified: true,
    });
    await e2e.state.auth.removePassword(passwordlessEmail);
    await e2e.state.auth.storeMailCounter({
      email: cappedEmail,
      purpose: MAIL_COUNTER_PURPOSE.PASSWORD_RESET,
      mailedCodes: MAILED_CODE_LIMIT_PER_ADDRESS,
    });
    const mailCount = (await e2e.captureMail()).length;
    const missingResponse = await postLifecycle(
      e2e,
      missingAttempt,
      'recovery/request',
      { email: missingEmail },
    ).expect(200);
    const deletedResponse = await postLifecycle(
      e2e,
      deletedAttempt,
      'recovery/request',
      { email: deletedEmail },
    ).expect(200);
    const passwordlessResponse = await postLifecycle(
      e2e,
      passwordlessAttempt,
      'recovery/request',
      { email: passwordlessEmail },
    ).expect(200);
    const cappedResponse = await postLifecycle(
      e2e,
      cappedAttempt,
      'recovery/request',
      { email: cappedEmail },
    ).expect(200);
    for (const [response, email] of [
      [missingResponse, missingEmail],
      [deletedResponse, deletedEmail],
      [passwordlessResponse, passwordlessEmail],
      [cappedResponse, cappedEmail],
    ] as const) {
      expect(parseLifecycleResult(response)).toMatchObject({
        stage: 'recoveryCodeRequired',
        email,
      });
    }
    for (const attempt of [
      missingAttempt,
      deletedAttempt,
      passwordlessAttempt,
      cappedAttempt,
    ]) {
      expect(
        (await storedAttempt(e2e, attempt)).details.emailCodeGenerationHash,
      ).toBeNull();
    }
    expect((await e2e.captureMail()).length).toBe(mailCount);
  });
  it('does not update the password when the submitted code has expired', async () => {
    const attempt = await requestCode();
    const code = await e2e.mailedCode();
    const pending = await e2e.state.auth.pendingPasswordResetFor(
      SEED_USER.email,
    );
    if (!pending) throw new Error('password reset code was not persisted');
    await e2e.state.auth.replacePendingPasswordResetCode(SEED_USER.email, {
      hashedCode: pending.hashedCode,
      attempts: 0,
      expiresAt: new Date(TEST_NOW.getTime() - 1),
    });
    const beforeVersion = await accountVersion();

    const rejected = await confirm(attempt, code).expect(400);
    expect(rejected.body.error.code).toBe(
      ErrorCode.PASSWORD_RESET_CODE_INVALID,
    );
    expect((await storedAttempt(e2e, attempt)).phase).toBe(
      NATIVE_ATTEMPT_PHASE.RECOVERY_CODE_REQUIRED,
    );
    expect(await accountVersion()).toBe(beforeVersion);
  });

  it('lets browser and native recovery consume one reset code only once', async () => {
    const attempt = await requestCode();
    const code = await e2e.mailedCode();
    const browser = await browserAgent(e2e.httpServer);
    const [nativeResult, browserResult] = await Promise.all([
      confirm(attempt, code, NEW_PASSWORD),
      browser.post('/api/auth/reset-password').send({
        email: SEED_USER.email,
        code,
        newPassword: ROTATED_PASSWORD,
      }),
    ]);

    expect(
      [nativeResult.status, browserResult.status].filter(
        (status) => status === 200,
      ),
    ).toHaveLength(1);
    expect(
      [nativeResult.status, browserResult.status].filter(
        (status) => status === 400,
      ),
    ).toHaveLength(1);
    const nativeLogin = await (
      await browserAgent(e2e.httpServer)
    )
      .post('/api/auth/login')
      .send({ email: SEED_USER.email, password: NEW_PASSWORD });
    const browserLogin = await (
      await browserAgent(e2e.httpServer)
    )
      .post('/api/auth/login')
      .send({ email: SEED_USER.email, password: ROTATED_PASSWORD });
    expect(
      [nativeLogin.status, browserLogin.status].filter(
        (status) => status === 200,
      ),
    ).toHaveLength(1);
    expect(
      [nativeLogin.status, browserLogin.status].filter(
        (status) => status === 401,
      ),
    ).toHaveLength(1);
  });

  it('resolves an unknown non-landing commit without spending proof or changing account authority', async () => {
    await loginAs(e2e.httpServer, SEED_USER);
    const sessionId = await e2e.state.sessions.sessionIdWithPurpose(
      CREDENTIAL_PURPOSE.BROWSER_SESSION,
    );
    if (!sessionId) throw new Error('browser session is missing');
    const attempt = await requestCode();
    const code = await e2e.mailedCode();
    const beforeVersion = await accountVersion();
    const restore = e2e.state.auth.makeCommitOutcomesUnknown({ lands: false });
    try {
      const outcome = await confirm(attempt, code).expect(503);
      expect(outcome.body.error.code).toBe(
        ErrorCode.TRANSACTION_OUTCOME_UNKNOWN,
      );
    } finally {
      restore();
    }

    expect(
      await e2e.state.auth.pendingPasswordResetFor(SEED_USER.email),
    ).not.toBeNull();
    expect((await storedAttempt(e2e, attempt)).phase).toBe(
      NATIVE_ATTEMPT_PHASE.RECOVERY_CODE_REQUIRED,
    );
    expect(await accountVersion()).toBe(beforeVersion);
    expect(await e2e.state.sessions.session(sessionId)).toMatchObject({
      isValid: true,
    });
    const retry = await confirm(attempt, code).expect(200);
    expect(parseLifecycleResult(retry).stage).toBe('recoveryComplete');
  });

  it('resolves a landed unknown commit from this attempt and keeps recovery out of sign-in', async () => {
    const attempt = await requestCode();
    const code = await e2e.mailedCode();
    const beforeVersion = await accountVersion();
    const restore = e2e.state.auth.makeCommitOutcomesUnknown({ lands: true });
    let completed: Awaited<ReturnType<typeof confirm>>;
    try {
      completed = await confirm(attempt, code).expect(200);
    } finally {
      restore();
    }
    expect(parseLifecycleResult(completed).stage).toBe('recoveryComplete');
    expect(await accountVersion()).toBe(beforeVersion + 1);
    expect((await storedAttempt(e2e, attempt)).phase).toBe(
      NATIVE_ATTEMPT_PHASE.RECOVERY_COMPLETE,
    );

    const wrongFlow = await startLifecycleAttempt(e2e, 'registration');
    await postLifecycle(e2e, wrongFlow, 'recovery/request', {
      email: SEED_USER.email,
    }).expect(409);
    expect(
      await e2e.state.auth.mailCounterFor(
        SEED_USER.email,
        MAIL_COUNTER_PURPOSE.PASSWORD_RESET,
      ),
    ).not.toBeNull();
  });
});
