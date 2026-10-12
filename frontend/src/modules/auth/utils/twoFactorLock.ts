import { ErrorCode, parseApiError } from '@app/core';

const MAX_LOCK_SECONDS = 60 * 60;

/** Reads the server's bounded lock duration without trusting arbitrary error details. */
export function twoFactorLockSeconds(error: unknown): number | null {
  const parsed = parseApiError(error);
  const retryAfter = parsed.details?.retryAfter;
  if (
    parsed.code !== ErrorCode.TWO_FACTOR_LOCKED ||
    typeof retryAfter !== 'number' ||
    !Number.isInteger(retryAfter) ||
    retryAfter < 1 ||
    retryAfter > MAX_LOCK_SECONDS
  ) {
    return null;
  }
  return retryAfter;
}
