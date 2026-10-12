import type { TransportResponse } from '@app/sdk';
import {
  AUTH_OPERATION,
  AUTH_REASON,
  NATIVE_AUTH_DISABLED_CODE,
  SESSION_STATUS,
} from '../constants';
import type { AuthRuntime } from '../runtime/runtime';

const FORBIDDEN = 403;

function errorCodeOf(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  const { error } = body;
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

/** The server's answer to any signed-in request once sign-in from apps is switched off. */
export function isKillSwitchResponse(response: TransportResponse): boolean {
  return response.status === FORBIDDEN && errorCodeOf(response.body) === NATIVE_AUTH_DISABLED_CODE;
}

/**
 * Stops using the session on this device. The server refuses the revoke route
 * too while the switch is off, so nothing is sent.
 */
export async function endSwitchedOffSession(runtime: AuthRuntime): Promise<void> {
  const endedEpoch = runtime.bumpEpoch();
  runtime.tokens = undefined;
  try {
    await runtime.deleteRecord(endedEpoch);
  } catch {
    if (!runtime.isEpochCurrent(endedEpoch)) return;
    runtime.setState(SESSION_STATUS.STORAGE_BLOCKED, AUTH_OPERATION.NONE, {
      reason: AUTH_REASON.STORAGE_FAILURE,
    });
    return;
  }
  if (!runtime.isEpochCurrent(endedEpoch)) return;
  runtime.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.NONE, {
    reason: AUTH_REASON.DISABLED,
  });
}
