import {
  TWO_FACTOR_LOCK_BASE_MS,
  TWO_FACTOR_LOCK_MAX_MS,
  TWO_FACTOR_LOCK_THRESHOLD,
} from '../constants/two-factor.constants';

const MS_PER_SECOND = 1000;
/** Past the cap the doubling would overflow long before it mattered. */
const MAX_DOUBLINGS = 30;

/**
 * How long the account is locked once it has given this many wrong answers
 * in a row, in milliseconds. Zero while the count is between two locks.
 *
 * Every fifth wrong answer locks: one minute at five, two at ten, four at
 * fifteen, doubling up to an hour. A correct answer starts the count again.
 */
export function lockDurationMs(failedAttempts: number): number {
  if (failedAttempts <= 0 || failedAttempts % TWO_FACTOR_LOCK_THRESHOLD !== 0) {
    return 0;
  }
  const locksSoFar = failedAttempts / TWO_FACTOR_LOCK_THRESHOLD;
  const doublings = Math.min(locksSoFar - 1, MAX_DOUBLINGS);
  return Math.min(
    TWO_FACTOR_LOCK_BASE_MS * 2 ** doublings,
    TWO_FACTOR_LOCK_MAX_MS,
  );
}

/** Whole seconds until `lockedUntil`, never less than one. */
export function retryAfterSeconds(lockedUntil: Date, now: number): number {
  return Math.max(1, Math.ceil((lockedUntil.getTime() - now) / MS_PER_SECOND));
}
