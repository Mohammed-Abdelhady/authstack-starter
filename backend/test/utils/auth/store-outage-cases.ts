import { PasswordResetCodeStore } from '../../../src/auth/pending-codes/password-reset-code.store';
import { PendingRegistrationStore } from '../../../src/auth/pending-codes/pending-registration.store';
import { MailCounterStore } from '../../../src/auth/pending-codes/mail-counter.store';
import {
  MAIL_COUNTER_PURPOSE,
  PENDING_PURPOSE,
} from '../../../src/auth/constants/registration';
import { TEST_NOW } from '../frozen-clock';

export type Statements = Record<string, () => Promise<unknown>>;

const UNAVAILABLE = 'PersistenceUnavailableError';
const EMAIL = 'outage@example.test';
const HOUR_MS = 3_600_000;

/** The name of what each statement raised, or `resolved` when it did not. */
export async function raisedBy(
  statements: Statements,
): Promise<Record<string, string>> {
  const raised: Record<string, string> = {};
  for (const [name, statement] of Object.entries(statements)) {
    raised[name] = await statement().then(
      () => 'resolved',
      (error: unknown) =>
        error instanceof Error ? error.constructor.name : typeof error,
    );
  }
  return raised;
}

export interface PendingCodeStores {
  mailCounters: MailCounterStore;
  registrations: PendingRegistrationStore;
  passwordResets: PasswordResetCodeStore;
}

/**
 * Every store method that is one statement committing by itself. `recordId`
 * is an id the database under test could have issued.
 */
export function pendingCodeStatements(
  stores: PendingCodeStores,
  recordId: string,
): Statements {
  const { mailCounters, registrations, passwordResets } = stores;
  const counter = { email: EMAIL, purpose: MAIL_COUNTER_PURPOSE.SIGNUP };
  const record = { email: EMAIL, purpose: PENDING_PURPOSE.SIGNUP };
  const generation = { hashedCode: 'hash', expiresAt: TEST_NOW };
  const attempts = {
    now: TEST_NOW,
    maxAttempts: 5,
    guesses: {
      limit: 5,
      lockBaseMs: HOUR_MS,
      lockMaxMs: HOUR_MS,
      maxLockLevel: 1,
      memoryMs: HOUR_MS,
    },
  };
  const window = { now: TEST_NOW, windowMs: HOUR_MS };
  return {
    'mail.recordWithinCap': () =>
      mailCounters.recordWithinCap(counter, { ...window, limit: 5 }),
    'mail.hasCounter': () => mailCounters.hasCounter(counter),
    'mail.openCounter': () => mailCounters.openCounter(counter, window),
    'mail.deleteExpiredBefore': () =>
      mailCounters.deleteExpiredBefore(TEST_NOW),
    'registration.rotateLiveCode': () =>
      registrations.rotateLiveCode(record, TEST_NOW, generation),
    'registration.replaceExpiredCode': () =>
      registrations.replaceExpiredCode(record, TEST_NOW, generation),
    'registration.hasRecord': () => registrations.hasRecord(record),
    'registration.dropExpiredRecord': () =>
      registrations.dropExpiredRecord(record, TEST_NOW),
    'registration.insertRecord': () =>
      registrations.insertRecord(record, generation),
    'registration.clearLegacyBlocker': () =>
      registrations.clearLegacyBlocker(EMAIL),
    'registration.reserveAttempt': () =>
      registrations.reserveAttempt(record, attempts),
    'reset.rotateCode': () => passwordResets.rotateCode(EMAIL, generation),
    'reset.insertRecord': () => passwordResets.insertRecord(EMAIL, generation),
    'reset.reserveAttempt': () =>
      passwordResets.reserveAttempt(EMAIL, attempts),
    'reset.claimCode': () =>
      passwordResets.claimCode({
        id: recordId,
        hashedCode: 'hash',
        now: TEST_NOW,
      }),
    'reset.dropExpiredRecord': () =>
      passwordResets.dropExpiredRecord(EMAIL, TEST_NOW),
  };
}

/** What every one of those statements raises while the database is away. */
export const PENDING_CODE_OUTAGES: Record<string, string> = {
  'mail.recordWithinCap': UNAVAILABLE,
  'mail.hasCounter': UNAVAILABLE,
  'mail.openCounter': UNAVAILABLE,
  'mail.deleteExpiredBefore': UNAVAILABLE,
  'registration.rotateLiveCode': UNAVAILABLE,
  'registration.replaceExpiredCode': UNAVAILABLE,
  'registration.hasRecord': UNAVAILABLE,
  'registration.dropExpiredRecord': UNAVAILABLE,
  'registration.insertRecord': UNAVAILABLE,
  'registration.clearLegacyBlocker': UNAVAILABLE,
  'registration.reserveAttempt': UNAVAILABLE,
  'reset.rotateCode': UNAVAILABLE,
  'reset.insertRecord': UNAVAILABLE,
  'reset.reserveAttempt': UNAVAILABLE,
  'reset.claimCode': UNAVAILABLE,
  'reset.dropExpiredRecord': UNAVAILABLE,
};
