import { API_PATHS, ApiError, OAuthError, TransportError } from '@app/sdk';
import type { ApiClient } from '@app/sdk';
import { SIGN_OUT_REVOKE_TIMEOUT_MS } from '../constants';
import { PortAbortController } from '../runtime/abort-controller';
import type { AuthDependencies, AbortSignalPort, RevocationOutcome } from '../types/auth';
import { requestWithDpopNonceRetry } from '../proof/dpop-requests';

export interface RevokeResult {
  outcome: RevocationOutcome;
  error?: Error | ApiError | OAuthError | TransportError;
}

export interface RevocationBinding {
  serverBaseAddress: string;
  proofKeyThumbprint: string;
}

// One revoke per token at a time for each engine; a second caller waits on the first.
const inFlight = new WeakMap<AuthDependencies, Map<string, Promise<RevokeResult>>>();

export function revokeWithDeadline(
  client: ApiClient<AbortSignalPort>,
  dependencies: AuthDependencies,
  token: string,
  clientId: string,
  binding?: RevocationBinding,
): Promise<RevokeResult> {
  let running = inFlight.get(dependencies);
  if (!running) {
    running = new Map();
    inFlight.set(dependencies, running);
  }
  const shared = running.get(token);
  if (shared) return shared;
  const revocation = sendRevoke(client, dependencies, token, clientId, binding);
  running.set(token, revocation);
  const owner = running;
  const settle = () => {
    if (owner.get(token) === revocation) owner.delete(token);
  };
  void revocation.then(settle, settle);
  return revocation;
}

async function sendRevoke(
  client: ApiClient<AbortSignalPort>,
  dependencies: AuthDependencies,
  token: string,
  clientId: string,
  binding?: RevocationBinding,
): Promise<RevokeResult> {
  const controller = new PortAbortController();
  let cancel = (): void => undefined;
  let timeOut = false;
  let resolveExpired: (result: RevokeResult) => void = () => undefined;
  const expired = new Promise<RevokeResult>((resolve) => {
    resolveExpired = resolve;
  });
  try {
    cancel = dependencies.timer.after(SIGN_OUT_REVOKE_TIMEOUT_MS, () => {
      timeOut = true;
      controller.abort();
      resolveExpired({ outcome: 'timedOut' });
    });
  } catch (error) {
    return { outcome: 'failed', error: asError(error) };
  }
  const request = binding
    ? requestWithDpopNonceRetry(
        {
          ...dependencies,
          serverBaseAddress: binding.serverBaseAddress,
          method: 'POST',
          path: API_PATHS.oauth.revoke,
          token,
          expectedThumbprint: binding.proofKeyThumbprint,
          signal: controller.signal,
          mayRetryChallenge: () => !controller.signal.aborted,
        },
        ({ headers }) =>
          client.oauth.revoke({ token, clientId }, { headers, signal: controller.signal }),
      ).then(({ value }) => value)
    : client.oauth.revoke({ token, clientId }, { signal: controller.signal });
  const revoke = request
    .then((): RevokeResult => ({ outcome: 'revoked' }))
    .catch((error: unknown): RevokeResult => ({
      outcome: 'failed',
      error: asError(error),
    }));
  try {
    return await Promise.race([revoke, expired]);
  } finally {
    try {
      cancel();
    } catch {
      // A broken timer cancel cannot change the revoke result.
    }
    if (!timeOut) controller.abort();
  }
}

export async function revokeQuietly(
  client: ApiClient<AbortSignalPort>,
  dependencies: AuthDependencies,
  token: string,
  clientId: string,
  binding?: RevocationBinding,
): Promise<void> {
  const result = await revokeWithDeadline(client, dependencies, token, clientId, binding);
  void result;
}

function asError(error: unknown): Error | ApiError | OAuthError | TransportError {
  return error instanceof Error ? error : new Error(String(error));
}
