import { AccountErasureHookError } from '../account-erasure-hook';
import {
  ERASURE_FAILURE,
  ERASURE_HOOK_CODE_PREFIX,
  ERASURE_RETRY_BASE_MS,
  ERASURE_RETRY_MAX_MS,
} from '../constants/erasure.constants';
import type { ErasureFailure } from '../types/erasure';

/** Doubles from `baseMs` with each failure until it reaches `maxMs`. */
export function growingDelayMs(
  failures: number,
  baseMs: number,
  maxMs: number,
): number {
  const doublings = Math.min(Math.max(failures - 1, 0), 30);
  return Math.min(baseMs * 2 ** doublings, maxMs);
}

/** A hook's own code when it gave a usable one, else the generic code. */
export function hookFailureCode(error: unknown): string {
  const named =
    error instanceof AccountErasureHookError ? error.usableCode : undefined;
  return named === undefined
    ? ERASURE_FAILURE.HOOK_FAILED
    : `${ERASURE_HOOK_CODE_PREFIX}${named}`;
}

/** The failure to store for a job that has now failed `failures` times. */
export function erasureFailure(
  code: string,
  failures: number,
  now: Date,
): ErasureFailure {
  const delay = growingDelayMs(
    failures,
    ERASURE_RETRY_BASE_MS,
    ERASURE_RETRY_MAX_MS,
  );
  return { code, at: now, nextAttemptAt: new Date(now.getTime() + delay) };
}
