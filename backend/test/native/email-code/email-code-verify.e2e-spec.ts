import { UnitOfWork } from '../../../src/common/persistence/unit-of-work';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { ACCOUNT_CREATION_METHOD } from '../../../src/auth/constants/account-creation';
import { NATIVE_CLIENT_ID } from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import {
  installAccountCreationPolicy,
  type SwitchableAccountCreationPolicy,
} from '../../utils/account-creation-policy';
import { TEST_NOW } from '../../utils/frozen-clock';
import { browserAgent } from '../../utils/e2e-sign-in'; // feature:email-password
import type { E2eApp } from '../../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import {
  parseLifecycleResult,
  postLifecycle,
  startLifecycleAttempt,
  storedAttempt,
  type StartedLifecycleAttempt,
} from '../lifecycle/native-lifecycle.fixtures';
import {
  asAnotherCaller,
  ATTEMPT_LIFETIME_MS,
  bootEmailCodeApp,
  CODE_LIFETIME_MS,
  errorCodeOf,
  lastSignInMail,
  otherCode,
  requestCode,
  setEmailCode,
  verifyCode,
} from './email-code.fixtures';

const MINE = 'me@example.test';
const GUESS_LIMIT = 5;

describe('native email code verify (e2e)', () => {
  let e2e: E2eApp;
  let policy: SwitchableAccountCreationPolicy;

  beforeAll(async () => {
    e2e = await bootEmailCodeApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    setEmailCode(e2e, true);
    policy = installAccountCreationPolicy(e2e.app);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  async function mailedAttempt(email = MINE) {
    const attempt = await startLifecycleAttempt(e2e, 'signIn');
    await requestCode(e2e, attempt, email).expect(200);
    const mail = await lastSignInMail(e2e);
    return { attempt, ...mail };
  }

  function verifyLink(attempt: StartedLifecycleAttempt, link: URL | null) {
    const fragment = new URLSearchParams(link?.hash.slice(1));
    return postLifecycle(e2e, attempt, 'email-link/verify', {
      token: fragment.get('native_email_token'),
      state: fragment.get('state'),
    });
  }

  async function expectInvalid(attempt: StartedLifecycleAttempt, code: string) {
    const refused = await verifyCode(e2e, attempt, code).expect(400);
    expect(errorCodeOf(refused)).toBe(ErrorCode.EMAIL_CODE_INVALID);
  }

  it('continues the right code like the email link and creates the unknown address through the policy', async () => {
    const { attempt, code } = await mailedAttempt();
    const verified = await verifyCode(e2e, attempt, code).expect(200);
    expect(parseLifecycleResult(verified).stage).toBe('consentRequired');
    expect(verified.headers['set-cookie']).toBeUndefined();
    const completed = await storedAttempt(e2e, attempt);
    expect(completed.details.verifiedAccount?.firstFactor).toBe('emailCode');
    expect(completed.details.verifiedAccount?.authenticationMethods).toEqual([
      'emailCode',
    ]);
    expect(completed.details.emailTokenHash).toBeNull();
    expect(completed.details.emailCodeGenerationHash).toBeNull();
    const account = await e2e.state.accounts.accountWithAddress(MINE);
    expect(account?.isVerified).toBe(true);
    expect(completed.details.verifiedAccount?.userId).toBe(account?._id);
    expect(policy.calls.map(({ request }) => request)).toEqual([
      {
        application: NATIVE_CLIENT_ID,
        method: ACCOUNT_CREATION_METHOD.EMAIL_CODE,
      },
      {
        application: NATIVE_CLIENT_ID,
        method: ACCOUNT_CREATION_METHOD.EMAIL_CODE,
      },
    ]);
    expect(policy.calls[1].unitOfWork).toBeInstanceOf(UnitOfWork);
  });

  it('accepts the right code after four wrong ones', async () => {
    const { attempt, code } = await mailedAttempt();
    for (let guess = 1; guess < GUESS_LIMIT; guess += 1) {
      await expectInvalid(attempt, otherCode(code));
    }
    await verifyCode(e2e, attempt, code).expect(200);
  });

  it('ends the attempt on the fifth wrong guess and leaves the address free for a new one', async () => {
    const { attempt, code } = await mailedAttempt();
    for (let guess = 1; guess <= GUESS_LIMIT; guess += 1) {
      await expectInvalid(attempt, otherCode(code));
    }
    expect((await storedAttempt(e2e, attempt)).phase).toBe('denied');
    await verifyCode(e2e, attempt, code).expect(409);

    const next = await mailedAttempt();
    await verifyCode(e2e, next.attempt, next.code).expect(200);
  });

  it('keeps my code when others guess wrong on their attempts or ask for a code for my address', async () => {
    const mine = await mailedAttempt();
    for (let other = 0; other < 3; other += 1) {
      asAnotherCaller(e2e);
      const theirs = await mailedAttempt();
      for (let guess = 1; guess <= GUESS_LIMIT; guess += 1) {
        await expectInvalid(theirs.attempt, otherCode(theirs.code));
      }
    }
    asAnotherCaller(e2e);
    const verified = await verifyCode(e2e, mine.attempt, mine.code).expect(200);
    expect(parseLifecycleResult(verified).stage).toBe('consentRequired');
  });

  it('refuses a code past its lifetime while the attempt lives, and the attempt expiry wins after', async () => {
    const { attempt, code } = await mailedAttempt();
    e2e.clock.advance(CODE_LIFETIME_MS);
    await expectInvalid(attempt, code);
    e2e.clock.set(new Date(TEST_NOW.getTime() + ATTEMPT_LIFETIME_MS));
    await verifyCode(e2e, attempt, code).expect(410);
  });

  it('accepts a code 1 ms before its lifetime ends', async () => {
    const { attempt, code } = await mailedAttempt();
    e2e.clock.advance(CODE_LIFETIME_MS - 1);
    await verifyCode(e2e, attempt, code).expect(200);
  });

  it('voids the earlier code and link of this attempt on a resend', async () => {
    const first = await mailedAttempt();
    await requestCode(e2e, first.attempt, MINE).expect(200);
    const second = await lastSignInMail(e2e);
    expect(second.code).not.toBe(first.code);

    await expectInvalid(first.attempt, first.code);
    const staleLink = await verifyLink(first.attempt, first.link).expect(400);
    expect(errorCodeOf(staleLink)).toBe(ErrorCode.MAGIC_LINK_INVALID);
    await verifyCode(e2e, first.attempt, second.code).expect(200);
  });

  it('voids the code once the link is spent', async () => {
    const { attempt, code, link } = await mailedAttempt();
    const linked = await verifyLink(attempt, link).expect(200);
    expect(parseLifecycleResult(linked).stage).toBe('consentRequired');
    await verifyCode(e2e, attempt, code).expect(409);
    expect(
      (await storedAttempt(e2e, attempt)).details.verifiedAccount?.firstFactor,
    ).toBe('emailLink');
  });

  it('voids the link once the code is spent', async () => {
    const { attempt, code, link } = await mailedAttempt();
    await verifyCode(e2e, attempt, code).expect(200);
    await verifyLink(attempt, link).expect(409);
    expect(
      (await storedAttempt(e2e, attempt)).details.verifiedAccount?.firstFactor,
    ).toBe('emailCode');
  });

  it('counts no guess for a body that fails validation', async () => {
    const { attempt, code } = await mailedAttempt();
    const arabicIndic = [...code]
      .map((digit) => String.fromCharCode(0x0660 + Number.parseInt(digit, 10)))
      .join('');
    for (let guess = 0; guess <= GUESS_LIMIT; guess += 1) {
      await verifyCode(e2e, attempt, arabicIndic).expect(400);
    }
    await verifyCode(e2e, attempt, code).expect(200);
  });

  // feature:email-password:start
  it('refuses a sign-up code here and a sign-in code at sign-up', async () => {
    const browser = await browserAgent(e2e.httpServer);
    await browser.post('/api/auth/register').send({ email: MINE }).expect(200);
    const signUpCode = await e2e.mailedCode();
    const { attempt, code } = await mailedAttempt();
    expect(code).not.toBe(signUpCode);

    await expectInvalid(attempt, signUpCode);
    // A browser proof is spent by one request, so activation takes a fresh one.
    const activating = await browserAgent(e2e.httpServer);
    const activation = await activating.post('/api/auth/activate').send({
      email: MINE,
      code,
      password: 'Fixture-password-1',
      name: 'Me',
    });
    expect(activation.status).toBe(400);
    expect(errorCodeOf(activation)).toBe(ErrorCode.ACTIVATION_CODE_INVALID);
    expect(await e2e.state.accounts.accountIdFor(MINE)).toBeNull();
    await verifyCode(e2e, attempt, code).expect(200);
  });
  // feature:email-password:end
});
