import { SENSITIVE_ACTION_WINDOW_MS } from '../../../session/constants/session-policy';

/** Name shown next to the account in an authenticator app. */
export const TWO_FACTOR_ISSUER = 'Auth Boilerplate';

/** Steps either side of the current one that a submitted code may fall in. */
export const TWO_FACTOR_WINDOW = 1;

/** Digits in a code. What every authenticator app shows. */
export const TOTP_DIGITS = 6;

/** Length of one TOTP step, in seconds. */
export const TOTP_STEP_SECONDS = 30;

/** The same step in milliseconds, for arithmetic against `Date.now()`. */
export const TOTP_STEP_MS = TOTP_STEP_SECONDS * 1000;

/** Cookie carrying the signed login challenge between sign-in and verify. */
export const TWO_FACTOR_CHALLENGE_COOKIE = 'mfa_challenge';

/** How long a login challenge stays usable, in milliseconds. */
export const TWO_FACTOR_CHALLENGE_TTL_MS = 300000;

/** Wrong codes a single challenge tolerates before it is discarded. */
export const TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS = 5;

/** Wrong answers an account may give before its second factor is locked. */
export const TWO_FACTOR_LOCK_THRESHOLD = 5;

/** How long the first lock holds, in milliseconds. Each later one doubles. */
export const TWO_FACTOR_LOCK_BASE_MS = 60000;

/** The longest a lock holds, in milliseconds. */
export const TWO_FACTOR_LOCK_MAX_MS = 3600000;

/**
 * How fresh a session has to be for a passwordless account to start setup.
 * Password accounts re-enter their password instead. The same window every
 * change to how an account signs in is held to.
 */
export const TWO_FACTOR_FRESH_SESSION_MS = SENSITIVE_ACTION_WINDOW_MS;

/** Recovery codes handed out by confirm and by regenerate. */
export const RECOVERY_CODE_COUNT = 10;

/** Characters per recovery code. */
export const RECOVERY_CODE_LENGTH = 10;

/**
 * Label the challenge secret is derived under, so the same key cannot be made
 * to sign anything else.
 */
export const TWO_FACTOR_CHALLENGE_HKDF_INFO = 'mfa-challenge';

/** Label the short name of an encryption key is derived under. */
export const TWO_FACTOR_KEY_ID_HKDF_INFO = 'totp-key-id';
