import { SENSITIVE_ACTION_WINDOW_MS } from '../../../session/constants/session-policy';

/**
 * A sign-in no older than the sensitive action window, the boundary included.
 * No sign-in time, or one that does not read as a date, is never recent.
 */
export function signedInRecently(
  signedInAt: Date | undefined,
  now: Date,
): boolean {
  const startedAt = signedInAt ? new Date(signedInAt).getTime() : 0;
  return now.getTime() - startedAt <= SENSITIVE_ACTION_WINDOW_MS;
}
