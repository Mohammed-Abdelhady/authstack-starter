import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { TEST_NOW } from '../../utils/frozen-clock';
import type { E2eApp } from '../../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import {
  parseLifecycleResult,
  startLifecycleAttempt,
  type StartedLifecycleAttempt,
} from '../lifecycle/native-lifecycle.fixtures';
import {
  asAnotherCaller,
  bootEmailCodeApp,
  CODE_LIFETIME_MS,
  errorCodeOf,
  lastSignInMail,
  otherCode,
  requestCode,
  setEmailCode,
  storedCode,
  verifyCode,
} from './email-code.fixtures';

const PERSON = 'guessed-at@example.test';
/** NIST SP 800-63B 5.2.2: wrong guesses at live codes one address takes in a UTC day. */
const CEILING = 100;
/** The fifth wrong code ends an attempt. */
const GUESSES_PER_ATTEMPT = 5;
/** The UTC day after the one `TEST_NOW` falls in. */
const NEXT_DAY = new Date('2099-01-02T00:00:00.000Z');
/** More than this case asks for, so the hourly mail cap never decides. */
const MAILS_PER_HOUR = 50;

interface Requested {
  attempt: StartedLifecycleAttempt;
  reply: ReturnType<typeof parseLifecycleResult>;
}

describe('native email code wrong-guess ceiling per address (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootEmailCodeApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    setEmailCode(e2e, true);
    e2e.app.get(ConfigService).set('magicLink.maxPerHour', MAILS_PER_HOUR);
    await e2e.state.accounts.createAccount({
      email: PERSON,
      name: 'Guessed At',
      isVerified: true,
    });
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  async function mailsToPerson(): Promise<number> {
    return (await e2e.captureMail()).filter(({ to }) => to === PERSON).length;
  }

  /** A new caller starts an attempt and asks for a code for the address. */
  async function requested(): Promise<Requested> {
    asAnotherCaller(e2e);
    const attempt = await startLifecycleAttempt(e2e, 'signIn');
    const response = await requestCode(e2e, attempt, PERSON).expect(200);
    return { attempt, reply: parseLifecycleResult(response) };
  }

  /** Requests a code and returns the one the mail carried. */
  async function requestedAndMailed(): Promise<Requested & { code: string }> {
    const asked = await requested();
    return { ...asked, code: (await lastSignInMail(e2e)).code };
  }

  async function guessWrong(
    attempt: StartedLifecycleAttempt,
    right: string,
    guesses: number,
  ): Promise<void> {
    for (let guess = 0; guess < guesses; guess += 1) {
      const refused = await verifyCode(e2e, attempt, otherCode(right)).expect(
        400,
      );
      expect(errorCodeOf(refused)).toBe(ErrorCode.EMAIL_CODE_INVALID);
    }
  }

  // Failure: wrong codes spread over many attempts never stop mails to one address, or dead codes count.
  it('mails an address no code for the rest of a UTC day after 100 wrong guesses at live codes, keeps mailed codes working, and mails again the next day', async () => {
    const lapsed = await requestedAndMailed();
    e2e.clock.advance(CODE_LIFETIME_MS);
    await guessWrong(lapsed.attempt, lapsed.code, GUESSES_PER_ATTEMPT);
    for (let round = 1; round < CEILING / GUESSES_PER_ATTEMPT; round += 1) {
      const guessed = await requestedAndMailed();
      await guessWrong(guessed.attempt, guessed.code, GUESSES_PER_ATTEMPT);
    }
    const mine = await requestedAndMailed();
    expect(await mailsToPerson()).toBe(21);

    const last = await requestedAndMailed();
    await guessWrong(last.attempt, last.code, GUESSES_PER_ATTEMPT - 1);
    await requestedAndMailed();
    expect(await mailsToPerson()).toBe(23);
    await guessWrong(last.attempt, last.code, 1);
    const capped = await requested();

    expect(await mailsToPerson()).toBe(23);
    expect({ ...capped.reply, attemptId: mine.attempt.attemptId }).toEqual(
      mine.reply,
    );
    expect((await storedCode(e2e, capped.attempt))?.spentAt).toEqual(
      new Date(TEST_NOW.getTime() + CODE_LIFETIME_MS),
    );
    asAnotherCaller(e2e);
    const signedIn = await verifyCode(e2e, mine.attempt, mine.code).expect(200);
    expect(parseLifecycleResult(signedIn).stage).toBe('consentRequired');

    e2e.clock.set(NEXT_DAY);
    await requestedAndMailed();
    expect(await mailsToPerson()).toBe(24);
  });
});
