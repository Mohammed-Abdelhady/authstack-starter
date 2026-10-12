import {
  MAIL_COUNTER_PURPOSE,
  PENDING_PURPOSE,
} from '../../../../src/auth/constants/registration';
import { TEST_NOW } from '../../frozen-clock';
import {
  CODE,
  contractServices,
  ContractServices,
  hashOf,
  HarnessSource,
  LIVE_EXPIRY,
  MAIL_WINDOW_MS,
} from './pending-codes-contract-support';
import {
  GUESS_LIMIT,
  GuessFlow,
  SIGNUP_FLOW,
  WRONG_GUESS,
} from './pending-codes-contract-guess-flows';

const EMAIL = 'both-counts@example.test';
const SIGNUP = PENDING_PURPOSE.SIGNUP;
const A_DAY_AFTER_THE_GUESS = new Date('2099-01-02T12:00:00.000Z');

/**
 * The mail count and the guess count of one address share a stored row and
 * nothing else: neither changes what the other allows or how long it is kept.
 */
export function guessAndMailCases(harness: HarnessSource): void {
  let services: ContractServices;
  let signup: GuessFlow;

  beforeEach(async () => {
    services = await contractServices(harness());
    signup = SIGNUP_FLOW.on(services, harness());
  });

  afterEach(() => {
    services.restore();
  });

  const guessWrong = async (times: number): Promise<void> => {
    for (let guess = 0; guess < times; guess += 1) {
      await signup.guess(EMAIL, WRONG_GUESS);
    }
  };
  const mail = () =>
    services.mailCounter.tryRecord(EMAIL, MAIL_COUNTER_PURPOSE.SIGNUP);
  const removeExpiredCounters = () =>
    harness().stores.mailCounters.deleteExpiredBefore(harness().clock.now());

  it('still mails a locked address and counts that mail', async () => {
    await signup.issue(EMAIL);
    await guessWrong(GUESS_LIMIT);

    const mailed = await mail();

    expect({
      mailed,
      counted: (await harness().counter(EMAIL, SIGNUP))?.mailedCodes,
    }).toEqual({ mailed: true, counted: 2 });
  });

  it('starts the mail count at one for an address whose guesses were counted first', async () => {
    await harness().seedRegistration({
      email: EMAIL,
      purpose: SIGNUP,
      hashedCode: await hashOf(CODE),
      attempts: 0,
      expiresAt: LIVE_EXPIRY,
    });
    await guessWrong(1);
    const beforeMail = (await harness().counter(EMAIL, SIGNUP))?.mailedCodes;

    const mails: boolean[] = [];
    for (let sent = 0; sent < 6; sent += 1) {
      mails.push(await mail());
    }

    expect({
      beforeMail,
      mails,
      stored: await harness().counter(EMAIL, SIGNUP),
      rows: await harness().counterCount(),
    }).toEqual({
      beforeMail: 0,
      mails: [true, true, true, true, true, false],
      stored: {
        email: EMAIL,
        purpose: 'signup',
        mailedCodes: 5,
        windowStartedAt: TEST_NOW,
        expiresAt: A_DAY_AFTER_THE_GUESS,
      },
      rows: 1,
    });
  });

  it('keeps counted guesses when cleanup runs at the end of the mail window', async () => {
    await signup.issue(EMAIL);
    await guessWrong(GUESS_LIMIT - 1);
    harness().clock.advance(MAIL_WINDOW_MS);

    const removed = await removeExpiredCounters();
    const fresh = await signup.issue(EMAIL);
    await guessWrong(1);

    expect({ removed, answer: await signup.guess(EMAIL, fresh) }).toEqual({
      removed: 0,
      answer: 'ACTIVATION_CODE_INVALID',
    });
  });

  it('keeps counted guesses when a later mail starts a new mail window', async () => {
    await signup.issue(EMAIL);
    await guessWrong(GUESS_LIMIT - 1);
    harness().clock.advance(MAIL_WINDOW_MS);
    await signup.issue(EMAIL);
    harness().clock.advance(MAIL_WINDOW_MS);

    const removed = await removeExpiredCounters();
    const fresh = await signup.issue(EMAIL);
    await guessWrong(1);

    expect({ removed, answer: await signup.guess(EMAIL, fresh) }).toEqual({
      removed: 0,
      answer: 'ACTIVATION_CODE_INVALID',
    });
  });

  it('removes the row once neither count needs it', async () => {
    await signup.issue(EMAIL);
    await guessWrong(1);
    harness().clock.set(new Date(A_DAY_AFTER_THE_GUESS.getTime() - 1));
    const early = await removeExpiredCounters();
    harness().clock.advance(1);

    expect({ early, onTime: await removeExpiredCounters() }).toEqual({
      early: 0,
      onTime: 1,
    });
  });
}
