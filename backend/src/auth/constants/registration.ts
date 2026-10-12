/**
 * Why a pending code record exists. A sign-up record builds an account when
 * its code is used; an email-change record only verifies a new address on an
 * account that already exists. The two never share a record or a code.
 */
export const PENDING_PURPOSE = {
  SIGNUP: 'signup',
  EMAIL_CHANGE: 'email-change',
} as const;

export type PendingPurpose =
  (typeof PENDING_PURPOSE)[keyof typeof PENDING_PURPOSE];

export const PENDING_PURPOSES: PendingPurpose[] =
  Object.values(PENDING_PURPOSE);

/**
 * Every kind of mail one address may receive that carries a per-address cap.
 * The counter is stored apart from the code record, by address and purpose, so
 * deleting an expired code record cannot reset the count.
 */
export const MAIL_COUNTER_PURPOSE = {
  SIGNUP: PENDING_PURPOSE.SIGNUP,
  EMAIL_CHANGE: PENDING_PURPOSE.EMAIL_CHANGE,
  NOTICE: 'notice',
  PASSWORD_RESET: 'password-reset',
} as const;

export type MailCounterPurpose =
  (typeof MAIL_COUNTER_PURPOSE)[keyof typeof MAIL_COUNTER_PURPOSE];

export const MAIL_COUNTER_PURPOSES: MailCounterPurpose[] =
  Object.values(MAIL_COUNTER_PURPOSE);

/**
 * Most codes one address is mailed inside a single window, counted at the
 * record and independent of the per-caller throttles. Over the limit the
 * caller still gets the generic reply and no new code is mailed.
 */
export const MAILED_CODE_LIMIT_PER_ADDRESS = 5;

/** Default code lifetime, used when the environment does not set one. */
export const ACTIVATION_CODE_EXPIRES_IN_DEFAULT = 900000;

/**
 * Boot ceiling on the configured code lifetime. A value past this is refused
 * before the server starts, so no deployment can configure a lifetime that
 * makes the derived window meaningless.
 */
export const ACTIVATION_CODE_EXPIRES_IN_MAX = 60 * 60 * 1000;

/**
 * The mail window is derived from the configured code lifetime but never
 * shorter than this. A one-minute code lifetime must not allow five mails a
 * minute to one address, so the per-address cap always counts over at least
 * fifteen minutes.
 */
export const MAILED_CODE_WINDOW_MIN_MS = 15 * 60 * 1000;

/** The window is one code lifetime when that is longer than the minimum. */
export const MAILED_CODE_WINDOW_FACTOR = 1;

/** Window a per-address mailed-code count resets on, at the default lifetime. */
export const MAILED_CODE_WINDOW_MS = Math.max(
  ACTIVATION_CODE_EXPIRES_IN_DEFAULT * MAILED_CODE_WINDOW_FACTOR,
  MAILED_CODE_WINDOW_MIN_MS,
);

/** The mail window for a configured code lifetime. */
export function mailedCodeWindowMs(codeExpiresIn: number): number {
  return Math.max(
    codeExpiresIn * MAILED_CODE_WINDOW_FACTOR,
    MAILED_CODE_WINDOW_MIN_MS,
  );
}

/**
 * Wrong codes one address may submit for one purpose before no code for it is
 * accepted for a while. Counted at the address, across every code it was
 * mailed, so a new code does not buy new guesses.
 */
export const CODE_GUESS_LIMIT = 5;

/** The first lock. Each lock that follows doubles, up to the longest one. */
export const CODE_GUESS_LOCK_BASE_MS = 15 * 60 * 1000;

export const CODE_GUESS_LOCK_MAX_MS = 24 * 60 * 60 * 1000;

/** Doublings after which the longest lock is reached: 15 minutes x 2^7 > 24 h. */
export const CODE_GUESS_LOCK_LEVEL_MAX = 7;

/**
 * How long wrong codes and earlier locks are remembered after the last wrong
 * code or the end of the last lock. A correct code forgets them at once.
 */
export const CODE_GUESS_MEMORY_MS = 24 * 60 * 60 * 1000;

export const CODE_GUESS_RULE = {
  limit: CODE_GUESS_LIMIT,
  lockBaseMs: CODE_GUESS_LOCK_BASE_MS,
  lockMaxMs: CODE_GUESS_LOCK_MAX_MS,
  maxLockLevel: CODE_GUESS_LOCK_LEVEL_MAX,
  memoryMs: CODE_GUESS_MEMORY_MS,
} as const;
