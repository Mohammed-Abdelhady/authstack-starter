import { ApiError, OAuthError, TransportError, TRANSPORT_FAILURE } from '@app/sdk';
import {
  AUTHORITY_UNAVAILABLE_CODE,
  RATE_LIMIT_EXCEEDED_CODE,
  REFRESH_THROTTLE_BACKOFF_MS,
  SESSION_STATUS,
} from '../constants';
import { AuthSessionError, authPortFailure, DpopChallengeLimitError } from '../errors/errors';
import { makeRecord } from '../storage/persistence';
import type { AuthRuntime } from '../runtime/runtime';
import type { AbortSignalPort } from '../types/auth';
import type { RuntimeTokens, SessionAuthRecord } from '../types/record';

export async function waitForThrottle(
  runtime: AuthRuntime,
  epoch: number,
  signal: AbortSignalPort,
): Promise<void> {
  const retryAt = runtime.refreshThrottleUntil;
  if (retryAt === undefined) return;
  while (runtime.isEpochCurrent(epoch) && runtime.snapshot.status === SESSION_STATUS.SIGNED_IN) {
    const remaining = retryAt - runtime.monotonicTime();
    if (remaining <= 0) {
      if (runtime.refreshThrottleUntil === retryAt) runtime.refreshThrottleUntil = undefined;
      return;
    }
    await waitForTimer(runtime, remaining, signal);
  }
  throw new AuthSessionError();
}

export function isKnownNonRotatingFailure(
  error: unknown,
): error is ApiError | DpopChallengeLimitError {
  if (error instanceof DpopChallengeLimitError) return true;
  return (
    error instanceof ApiError &&
    ((error.status === 429 && error.code === RATE_LIMIT_EXCEEDED_CODE) ||
      (error.status === 503 && error.code === AUTHORITY_UNAVAILABLE_CODE))
  );
}

export function safeThrottleDeadline(runtime: AuthRuntime): number | undefined {
  try {
    return runtime.monotonicTime() + REFRESH_THROTTLE_BACKOFF_MS;
  } catch {
    return undefined;
  }
}

export function makeRefreshRecord(
  runtime: AuthRuntime,
  installDigest: string,
  tokens: Pick<RuntimeTokens, 'accessToken' | 'refreshToken' | 'lineageId' | 'proofKeyThumbprint'>,
  refreshInFlight = false,
): SessionAuthRecord {
  const base = makeRecord(runtime.config, installDigest);
  return {
    schemaVersion: base.schemaVersion,
    serverBaseAddress: base.serverBaseAddress,
    environment: base.environment,
    clientId: base.clientId,
    installDigest: base.installDigest,
    lineageId: tokens.lineageId,
    ...(tokens.proofKeyThumbprint === undefined
      ? {}
      : { proofKeyThumbprint: tokens.proofKeyThumbprint }),
    tokens: { refreshToken: tokens.refreshToken },
    ...(refreshInFlight ? { refreshInFlight: true } : {}),
  };
}

export function normalizeRefreshError(error: unknown): unknown {
  if (error instanceof TransportError) return error;
  if (error instanceof ApiError || error instanceof OAuthError) return error;
  return new TransportError(TRANSPORT_FAILURE.NO_RESPONSE, { cause: error });
}

function waitForTimer(
  runtime: AuthRuntime,
  milliseconds: number,
  signal: AbortSignalPort,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let cancel = (): void => undefined;
    let unsubscribeEpoch = (): void => undefined;
    let completed = false;
    const finish = (error?: unknown): void => {
      if (completed) return;
      completed = true;
      try {
        cancel();
      } catch {
        // Timer cancellation cannot change the refresh result.
      }
      unsubscribeEpoch();
      try {
        signal.removeEventListener('abort', abort);
      } catch {
        // Listener cleanup cannot change the refresh result.
      }
      if (error === undefined) resolve();
      else reject(error);
    };
    try {
      cancel = runtime.dependencies.timer.after(milliseconds, () => finish());
      unsubscribeEpoch = runtime.onEpochChange(() => finish(new AuthSessionError()));
      signal.addEventListener('abort', abort);
    } catch (error) {
      finish(authPortFailure(error, 'timer.after'));
      return;
    }
    if (completed) {
      try {
        cancel();
      } catch {
        // A synchronously firing timer has already completed this wait.
      }
    }

    function abort(): void {
      finish(new TransportError(TRANSPORT_FAILURE.ABORTED));
    }
  });
}
