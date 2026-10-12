import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { RerunPause } from '../../../../src/common/persistence/unit-of-work';
import { HashService } from '../../../../src/common/services/hash.service';
import { PasswordResetCodeService } from '../../../../src/auth/services/codes/password-reset-code.service';
import { VerificationCodeService } from '../../../../src/auth/services/codes/verification-code.service';
import { MailCounterService } from '../../../../src/auth/services/mail/mail-counter.service';
import { TEST_NOW } from '../../frozen-clock';
import {
  PendingCodesContractHarness,
  PendingCodeStores,
} from './pending-codes-contract-harness';

export type HarnessSource = () => PendingCodesContractHarness;

/** Written out, so a changed constant cannot agree with itself. */
export const MAIL_CAP = 5;
export const MAX_ATTEMPTS = 5;
export const CODE_LIFETIME_MS = 900_000;
export const MAIL_WINDOW_MS = 900_000;
export const CODE = '123456';
export const WRONG_CODE = '000000';
export const BCRYPT_ROUNDS = 4;
/** Five guesses, then 15 minutes that double up to a day, kept for a day. */
export const GUESS_RULE = {
  limit: 5,
  lockBaseMs: 900_000,
  lockMaxMs: 86_400_000,
  maxLockLevel: 7,
  memoryMs: 86_400_000,
};

export const LIVE_EXPIRY = new Date(TEST_NOW.getTime() + CODE_LIFETIME_MS);
export const EXPIRED_EXPIRY = new Date(TEST_NOW.getTime() - 1000);

export const rerunAtOnce: RerunPause = () => Promise.resolve();

export function hashOf(code: string): Promise<string> {
  return bcrypt.hash(code, BCRYPT_ROUNDS);
}

export function matches(code: string, hashedCode: string): Promise<boolean> {
  return bcrypt.compare(code, hashedCode);
}

/**
 * Passes every call through to the real store and writes its name down first,
 * so a case can say which statements one request made and in what order.
 */
export function recorded<Store extends object>(
  store: Store,
  label: string,
  calls: string[],
): Store {
  return new Proxy(store, {
    get(target, property) {
      const member: unknown = Reflect.get(target, property, target);
      if (typeof member !== 'function' || typeof property !== 'string') {
        return member;
      }
      return (...args: unknown[]): unknown => {
        calls.push(`${label}.${property}`);
        return Reflect.apply(member, target, args);
      };
    },
  });
}

export interface ContractServices {
  mailCounter: MailCounterService;
  verification: VerificationCodeService;
  passwordReset: PasswordResetCodeService;
  hash: HashService;
  /** Every store call the services made, in order, since the last `clear`. */
  storeCalls: string[];
  /** Hashes made and comparisons run since the last `clear`. */
  hashWork(): { hashes: number; comparisons: number };
  clear(): void;
  restore(): void;
}

/**
 * The real services on one database's adapters, with the cap, the attempt
 * limit and the code lifetime the cases write out by hand.
 */
export async function contractServices(
  harness: PendingCodesContractHarness,
): Promise<ContractServices> {
  const config = new ConfigService({
    activation: { maxAttempts: MAX_ATTEMPTS, codeExpiresIn: CODE_LIFETIME_MS },
    bcrypt: { rounds: BCRYPT_ROUNDS },
  });
  const storeCalls: string[] = [];
  const stores: PendingCodeStores = {
    mailCounters: recorded(harness.stores.mailCounters, 'mail', storeCalls),
    registrations: recorded(
      harness.stores.registrations,
      'registration',
      storeCalls,
    ),
    passwordResets: recorded(
      harness.stores.passwordResets,
      'reset',
      storeCalls,
    ),
  };
  const hash = new HashService(config);
  const hashSpy = jest.spyOn(hash, 'hash');
  const compareSpy = jest.spyOn(hash, 'compare');
  const mailCounter = new MailCounterService(
    stores.mailCounters,
    config,
    harness.clock,
  );
  const clear = (): void => {
    storeCalls.length = 0;
    hashSpy.mockClear();
    compareSpy.mockClear();
  };
  // The dummy hash a refused code is compared against is made on first use.
  // Make it now, so no case counts it as one of its own hashes.
  await hash.spendComparison(CODE);
  clear();

  return {
    mailCounter,
    verification: new VerificationCodeService(
      stores.registrations,
      hash,
      config,
      harness.clock,
      mailCounter,
    ),
    passwordReset: new PasswordResetCodeService(
      stores.passwordResets,
      hash,
      config,
      harness.clock,
    ),
    hash,
    storeCalls,
    hashWork: () => ({
      hashes: hashSpy.mock.calls.length,
      comparisons: compareSpy.mock.calls.length,
    }),
    clear,
    restore: () => {
      hashSpy.mockRestore();
      compareSpy.mockRestore();
    },
  };
}

/** Awaits a promise that must reject and hands back what it rejected with. */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

/** The application error code of a rejection, or the error's own name. */
export function codeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'getCode' in error) {
    const getCode: unknown = error.getCode;
    if (typeof getCode === 'function') {
      return String(Reflect.apply(getCode, error, []));
    }
  }
  return error instanceof Error ? error.name : typeof error;
}
