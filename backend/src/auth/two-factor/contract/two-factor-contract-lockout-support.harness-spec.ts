import { createHash } from 'node:crypto';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { AppException } from '../../../common/exceptions/app.exception';
import { SecondFactorAccount } from '../stores/second-factor-account';
import {
  challengedBrowser,
  outcomeOf,
  TOTP_SECRET,
  TwoFactorContractHarness,
  TwoFactorServices,
  wrongCode,
} from './two-factor-contract.harness-spec';

/** Written out, so a changed constant cannot agree with itself. */
export const FIRST_LOCK_MS = 60_000;
export const LONGEST_LOCK_MS = 3_600_000;
export const CODE_INVALID = 'TWO_FACTOR_CODE_INVALID';
export const LOCKED = 'TWO_FACTOR_LOCKED';
/** Ten base32 characters each, none of them a code the fixture hands out. */
export const SPARE_CODES = [
  'AAAAAAAAA2',
  'AAAAAAAAA3',
  'AAAAAAAAA4',
  'AAAAAAAAA5',
  'AAAAAAAAA6',
  'AAAAAAAAA7',
];

/** The stored form of a recovery code, worked out apart from the service. */
export function sha256(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** The instant this long after the frozen time. */
export function after(ms: number): Date {
  return new Date(TEST_NOW.getTime() + ms);
}

export interface LockAnswer {
  code: string;
  status: number;
  retryAfter: unknown;
}

/** Awaits a promise that must be refused and hands back how, with its details. */
export async function answerOf(promise: Promise<unknown>): Promise<LockAnswer> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppException) {
      return {
        code: error.code,
        status: error.getStatus(),
        retryAfter: error.getDetails()?.retryAfter,
      };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

export async function read(
  harness: TwoFactorContractHarness,
  userId: string,
): Promise<SecondFactorAccount> {
  const account = await harness.accounts.findAccount(userId);
  if (!account) throw new Error('the seeded account was not found');
  return account;
}

/** One wrong code at the second step of a sign-in of its own. */
export async function wrongSignIn(
  harness: TwoFactorContractHarness,
  services: TwoFactorServices,
  userId: string,
): Promise<string> {
  const holder = await challengedBrowser(services, userId);
  return outcomeOf(
    services.login.verify(
      { code: wrongCode(harness.clock, TOTP_SECRET) },
      holder.request,
      holder.response,
    ),
  );
}
