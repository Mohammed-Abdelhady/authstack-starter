import { RaceGate } from '../../race-gate';
import {
  contractServices,
  ContractServices,
  HarnessSource,
} from './pending-codes-contract-support';
import {
  FIRST_LOCK_MS,
  GUESS_FLOWS,
  GUESS_LIMIT,
  GUESS_MEMORY_MS,
  GuessFlow,
  LONGEST_LOCK_MS,
  PASSWORD_RESET_FLOW,
  SIGNUP_FLOW,
  WRONG_GUESS,
} from './pending-codes-contract-guess-flows';

const EMAIL = 'guessed@example.test';
const OTHER_EMAIL = 'bystander@example.test';
const MINUTE_MS = 60_000;
/** Each lock doubles the one before: 15 minutes up to 16 hours, then a day. */
const LOCKS_UP_TO_THE_LONGEST = [15, 30, 60, 120, 240, 480, 960, 1440].map(
  (minutes) => minutes * MINUTE_MS,
);

/**
 * Wrong codes are counted at the address and purpose, across every code the
 * address was mailed, and enough of them lock it for a time that grows.
 */
export function codeGuessCases(harness: HarnessSource): void {
  let services: ContractServices;

  beforeEach(async () => {
    services = await contractServices(harness());
  });

  afterEach(() => {
    services.restore();
  });

  describe.each(GUESS_FLOWS)('for a $name code', (definition) => {
    const flow = (): GuessFlow => definition.on(services, harness());
    const guessWrong = async (times: number, email = EMAIL): Promise<void> => {
      for (let guess = 0; guess < times; guess += 1) {
        await flow().guess(email, WRONG_GUESS);
      }
    };
    const lock = async (): Promise<void> => {
      await flow().issue(EMAIL);
      await guessWrong(GUESS_LIMIT);
    };

    it('adds up the wrong codes sent against different codes of one address', async () => {
      await flow().issue(EMAIL);
      await guessWrong(3);
      const second = await flow().issue(EMAIL);
      await guessWrong(2);

      expect(await flow().guess(EMAIL, second)).toBe(definition.refusal);
    });

    it('accepts the right code as the last allowed guess', async () => {
      await flow().issue(EMAIL);
      await guessWrong(2);
      const second = await flow().issue(EMAIL);
      await guessWrong(2);

      expect(await flow().guess(EMAIL, second)).toBe('accepted');
    });

    it('refuses a right code until the lock ends, and accepts it from then', async () => {
      await lock();
      harness().clock.advance(FIRST_LOCK_MS - 1);
      const fresh = await flow().issue(EMAIL);

      const duringLock = await flow().guess(EMAIL, fresh);
      harness().clock.advance(1);
      const afterLock = await flow().guess(EMAIL, fresh);

      expect({ duringLock, afterLock }).toEqual({
        duringLock: definition.refusal,
        afterLock: 'accepted',
      });
    });

    it('answers a right code during the lock exactly as it answers a wrong code', async () => {
      const code = await flow().issue(EMAIL);
      const wrong = await flow().refusalOf(EMAIL, WRONG_GUESS);
      await guessWrong(GUESS_LIMIT - 1);

      const locked = await flow().refusalOf(EMAIL, code);

      expect({
        code: locked.code,
        status: locked.status,
        sameAsWrong:
          [locked.code, locked.status, locked.message].join() ===
          [wrong.code, wrong.status, wrong.message].join(),
      }).toEqual({
        code: definition.refusal,
        status: definition.status,
        sameAsWrong: true,
      });
    });

    it('doubles the lock when the address is locked again', async () => {
      await lock();
      harness().clock.advance(FIRST_LOCK_MS);
      await lock();
      harness().clock.advance(2 * FIRST_LOCK_MS - 1);
      const fresh = await flow().issue(EMAIL);

      const duringLock = await flow().guess(EMAIL, fresh);
      harness().clock.advance(1);
      const afterLock = await flow().guess(EMAIL, fresh);

      expect({ duringLock, afterLock }).toEqual({
        duringLock: definition.refusal,
        afterLock: 'accepted',
      });
    });

    it('stops doubling at a day', async () => {
      for (const lockMs of LOCKS_UP_TO_THE_LONGEST) {
        await lock();
        harness().clock.advance(lockMs);
      }
      await lock();
      harness().clock.advance(LONGEST_LOCK_MS - 1);
      const fresh = await flow().issue(EMAIL);

      const duringLock = await flow().guess(EMAIL, fresh);
      harness().clock.advance(1);
      const afterLock = await flow().guess(EMAIL, fresh);

      expect({ duringLock, afterLock }).toEqual({
        duringLock: definition.refusal,
        afterLock: 'accepted',
      });
    });

    it('forgets the wrong codes and the earlier locks when a right code is used', async () => {
      await lock();
      harness().clock.advance(FIRST_LOCK_MS);
      const first = await flow().issue(EMAIL);
      await guessWrong(GUESS_LIMIT - 1);
      const used = await flow().redeem(EMAIL, first);
      await lock();
      harness().clock.advance(FIRST_LOCK_MS);
      const fresh = await flow().issue(EMAIL);

      expect({
        used,
        afterFirstLockLength: await flow().guess(EMAIL, fresh),
      }).toEqual({
        used: true,
        afterFirstLockLength: 'accepted',
      });
    });

    it('still counts wrong codes one millisecond before they are forgotten', async () => {
      await flow().issue(EMAIL);
      await guessWrong(GUESS_LIMIT - 1);
      harness().clock.advance(GUESS_MEMORY_MS - 1);
      const fresh = await flow().issue(EMAIL);
      await guessWrong(1);

      expect(await flow().guess(EMAIL, fresh)).toBe(definition.refusal);
    });

    it('starts from nothing once the wrong codes are forgotten', async () => {
      await flow().issue(EMAIL);
      await guessWrong(GUESS_LIMIT - 1);
      harness().clock.advance(GUESS_MEMORY_MS);
      const fresh = await flow().issue(EMAIL);
      await guessWrong(GUESS_LIMIT - 1);

      expect(await flow().guess(EMAIL, fresh)).toBe('accepted');
    });

    it('does not count a guess at an address that has no live code', async () => {
      await guessWrong(GUESS_LIMIT);
      const code = await flow().issue(EMAIL);

      expect(await flow().guess(EMAIL, code)).toBe('accepted');
    });

    it('locks one address and leaves another address alone', async () => {
      await lock();
      const other = await flow().issue(OTHER_EMAIL);

      expect(await flow().guess(OTHER_EMAIL, other)).toBe('accepted');
    });

    it('admits one of two simultaneous guesses at the last allowed guess', async () => {
      await flow().issue(EMAIL);
      await guessWrong(2);
      const second = await flow().issue(EMAIL);
      await guessWrong(2);
      const gate = new RaceGate();
      const restore = flow().holdGuesses((call) =>
        call < 2 ? gate : undefined,
      );
      let answers: string[];
      try {
        const both = [flow().guess(EMAIL, second), flow().guess(EMAIL, second)];
        await gate.reached(2);
        gate.release();
        answers = await Promise.all(both);
      } finally {
        restore();
      }

      expect([...answers].sort()).toEqual(
        ['accepted', definition.refusal].sort(),
      );
    });
  });

  it('keeps each purpose of one address on its own count', async () => {
    const signup = SIGNUP_FLOW.on(services, harness());
    const reset = PASSWORD_RESET_FLOW.on(services, harness());
    await signup.issue(EMAIL);
    for (let guess = 0; guess < GUESS_LIMIT; guess += 1) {
      await signup.guess(EMAIL, WRONG_GUESS);
    }
    const lockedCode = await signup.issue(EMAIL);
    const resetCode = await reset.issue(EMAIL);

    expect({
      signup: await signup.guess(EMAIL, lockedCode),
      reset: await reset.guess(EMAIL, resetCode),
    }).toEqual({ signup: 'ACTIVATION_CODE_INVALID', reset: 'accepted' });
  });
}
