import { emailCodeDeliveryCases } from './email-code-delivery.harness-spec';
import { FrozenClock, TEST_NOW } from '../../../test/utils/frozen-clock';
import { UnitOfWorkRunner } from '../../common/persistence/unit-of-work';
import {
  EMAIL_CODE_GUESS_LIMIT,
  EMAIL_CODE_PURPOSE,
  EmailCodeKey,
  EmailCodeStore,
  NewEmailCode,
} from './email-code.store';

export interface EmailCodeHarness {
  store: EmailCodeStore;
  clock: FrozenClock;
  unitOfWork: UnitOfWorkRunner;
  reset: () => Promise<void>;
  close: () => Promise<void>;
  checkSetup: () => Promise<void>;
  /** Removes what this database's own cleanup removes at the clock's time. */
  cleanUp: () => Promise<void>;
}

const LIFETIME_MS = 600_000;
/** The owner, an attempt, outlives its code. */
const OWNER_LIFETIME_MS = 900_000;
const MINE: EmailCodeKey = {
  ownerId: 'attempt-mine',
  purpose: EMAIL_CODE_PURPOSE.SIGN_IN,
};
const THEIRS: EmailCodeKey = {
  ownerId: 'attempt-theirs',
  purpose: EMAIL_CODE_PURPOSE.SIGN_IN,
};

function code(
  key: EmailCodeKey,
  codeHash: string,
  overrides: Partial<NewEmailCode> = {},
): NewEmailCode {
  return {
    ...key,
    email: 'Person@Example.Test ',
    codeHash,
    expiresAt: new Date(TEST_NOW.getTime() + LIFETIME_MS),
    purgeAfter: new Date(TEST_NOW.getTime() + OWNER_LIFETIME_MS),
    spent: false,
    ...overrides,
  };
}

/** One contract for every database: codes per attempt, guesses per attempt, one spend. */
export function describeEmailCodeContract(
  name: string,
  boot: () => Promise<EmailCodeHarness>,
): void {
  describe(`${name} email code store`, () => {
    let harness: EmailCodeHarness;

    beforeAll(async () => {
      harness = await boot();
    }, 120_000);
    afterAll(async () => {
      await harness?.close();
    }, 120_000);
    beforeEach(async () => {
      harness.clock.set(TEST_NOW);
      await harness.reset();
    }, 120_000);

    function spend(key: EmailCodeKey, codeHash: string) {
      return harness.unitOfWork.run((unitOfWork) =>
        harness.store.spendIn(unitOfWork, key, {
          codeHash,
          limit: EMAIL_CODE_GUESS_LIMIT,
        }),
      );
    }

    emailCodeDeliveryCases(() => harness);

    it('has the owner uniqueness and expiry setup', async () => {
      await harness.checkSetup();
    });

    it('stores the address in its canonical form and starts with no guesses', async () => {
      const stored = await harness.store.put(code(MINE, 'hash-1'));
      expect(stored).toEqual({
        ownerId: 'attempt-mine',
        purpose: 'sign-in',
        email: 'person@example.test',
        codeHash: 'hash-1',
        wrongGuesses: 0,
        expiresAt: new Date(TEST_NOW.getTime() + LIFETIME_MS),
        purgeAfter: new Date(TEST_NOW.getTime() + OWNER_LIFETIME_MS),
        spentAt: null,
      });
      expect(await harness.store.find(MINE)).toEqual(stored);
      expect(await harness.store.find(THEIRS)).toBeNull();
    });

    it('spends a code once, and a stored-spent code never', async () => {
      await harness.store.put(code(MINE, 'hash-1'));
      await harness.store.put(code(THEIRS, 'hash-2', { spent: true }));
      expect(await spend(MINE, 'hash-1')).toBe(true);
      expect(await spend(MINE, 'hash-1')).toBe(false);
      expect(await spend(THEIRS, 'hash-2')).toBe(false);
      expect((await harness.store.find(THEIRS))?.spentAt).toEqual(TEST_NOW);
    });

    it('lets one of two concurrent spends of the same code succeed', async () => {
      await harness.store.put(code(MINE, 'hash-1'));
      const results = await Promise.allSettled([
        spend(MINE, 'hash-1'),
        spend(MINE, 'hash-1'),
      ]);
      const spent = results.filter(
        (result) => result.status === 'fulfilled' && result.value,
      );
      expect(spent).toHaveLength(1);
    });

    it('leaves the code unspent when the unit of work rolls back', async () => {
      await harness.store.put(code(MINE, 'hash-1'));
      await expect(
        harness.unitOfWork.run(async (unitOfWork) => {
          await harness.store.spendIn(unitOfWork, MINE, {
            codeHash: 'hash-1',
            limit: EMAIL_CODE_GUESS_LIMIT,
          });
          throw new Error('completion refused');
        }),
      ).rejects.toThrow('completion refused');
      expect(await spend(MINE, 'hash-1')).toBe(true);
    });

    it('accepts a code 1 ms before its expiry and refuses it at expiry', async () => {
      await harness.store.put(code(MINE, 'hash-1'));
      await harness.store.put(code(THEIRS, 'hash-2'));
      harness.clock.advance(LIFETIME_MS - 1);
      expect(await spend(MINE, 'hash-1')).toBe(true);
      harness.clock.advance(1);
      expect(await spend(THEIRS, 'hash-2')).toBe(false);
    });

    it('replaces only this owner code and keeps its wrong guesses', async () => {
      await harness.store.put(code(MINE, 'hash-1'));
      await harness.store.put(code(THEIRS, 'hash-2'));
      expect(
        await harness.store.recordWrongGuess(MINE, EMAIL_CODE_GUESS_LIMIT),
      ).toBe(1);
      await harness.store.put(code(MINE, 'hash-3'));
      expect(await spend(MINE, 'hash-1')).toBe(false);
      expect((await harness.store.find(MINE))?.wrongGuesses).toBe(1);
      expect(await spend(THEIRS, 'hash-2')).toBe(true);
      expect(await spend(MINE, 'hash-3')).toBe(true);
    });

    it('spends the code on the guess that reaches the limit, for that owner only', async () => {
      await harness.store.put(code(MINE, 'hash-1'));
      await harness.store.put(code(THEIRS, 'hash-2'));
      const counts: (number | null)[] = [];
      for (let guess = 0; guess < EMAIL_CODE_GUESS_LIMIT; guess += 1) {
        counts.push(
          await harness.store.recordWrongGuess(THEIRS, EMAIL_CODE_GUESS_LIMIT),
        );
      }
      expect(counts).toEqual([1, 2, 3, 4, 5]);
      expect((await harness.store.find(THEIRS))?.spentAt).toEqual(TEST_NOW);
      expect(await spend(THEIRS, 'hash-2')).toBe(false);
      expect(await spend(MINE, 'hash-1')).toBe(true);
    });

    it('still spends after four wrong guesses', async () => {
      await harness.store.put(code(MINE, 'hash-1'));
      for (let guess = 1; guess < EMAIL_CODE_GUESS_LIMIT; guess += 1) {
        await harness.store.recordWrongGuess(MINE, EMAIL_CODE_GUESS_LIMIT);
      }
      expect((await harness.store.find(MINE))?.spentAt).toBeNull();
      expect(await spend(MINE, 'hash-1')).toBe(true);
    });

    it('counts no guess for an owner with no code', async () => {
      expect(
        await harness.store.recordWrongGuess(MINE, EMAIL_CODE_GUESS_LIMIT),
      ).toBeNull();
      expect(await harness.store.find(MINE)).toBeNull();
    });

    it('keeps four wrong guesses through cleanup and a resend while the owner lives', async () => {
      await harness.store.put(code(MINE, 'hash-1'));
      for (let guess = 1; guess < EMAIL_CODE_GUESS_LIMIT; guess += 1) {
        await harness.store.recordWrongGuess(MINE, EMAIL_CODE_GUESS_LIMIT);
      }
      harness.clock.advance(LIFETIME_MS);
      await harness.cleanUp();
      // The resend's code may live only as long as what is left of the owner.
      await harness.store.put(
        code(MINE, 'hash-2', {
          expiresAt: new Date(TEST_NOW.getTime() + OWNER_LIFETIME_MS),
        }),
      );

      expect((await harness.store.find(MINE))?.wrongGuesses).toBe(4);
      expect(
        await harness.store.recordWrongGuess(MINE, EMAIL_CODE_GUESS_LIMIT),
      ).toBe(EMAIL_CODE_GUESS_LIMIT);
      expect(await spend(MINE, 'hash-2')).toBe(false);
    });

    it('lets cleanup remove a row once its owner has ended', async () => {
      await harness.store.put(code(MINE, 'hash-1'));
      harness.clock.advance(OWNER_LIFETIME_MS - 1);
      await harness.cleanUp();
      expect(await harness.store.find(MINE)).not.toBeNull();
      harness.clock.advance(1);
      await harness.cleanUp();
      expect(await harness.store.find(MINE)).toBeNull();
    });
  });
}
