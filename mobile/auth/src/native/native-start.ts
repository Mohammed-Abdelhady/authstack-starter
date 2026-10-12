import { ApiError, TransportError } from '@app/sdk';
import type { ApiClient, NativeAttemptStartResult, NativeFlow } from '@app/sdk';
import { AUTH_OPERATION, NATIVE_ATTEMPT_LIFETIME_MS, SESSION_STATUS } from '../constants';
import { prepareSignIn } from '../sign-in/sign-in-transaction';
import { transactionExpired } from '../storage/persistence';
import type { AuthRuntime } from '../runtime/runtime';
import type { AbortSignalPort } from '../types/auth';
import type { PendingAuthRecord } from '../types/record';
import type { NativeSignInOutcome } from '../types/native-sign-in';

export async function beginNativeAttempt(
  runtime: AuthRuntime,
  client: ApiClient<AbortSignalPort>,
  flow: NativeFlow,
  epoch: number,
  signal: AbortSignalPort,
): Promise<NativeSignInOutcome> {
  const prepared = await prepareSignIn(runtime, epoch, SESSION_STATUS.SIGNED_OUT);
  if (prepared.kind === 'outcome') {
    return prepared.outcome.kind === 'storageFailure'
      ? { kind: 'storageFailure' }
      : { kind: 'signedOut' };
  }
  if (!runtime.isEpochCurrent(epoch)) return { kind: 'signedOut' };
  let started: NativeAttemptStartResult;
  try {
    started = await client.nativeAuth.start(
      {
        clientId: runtime.config.clientId,
        redirectUri: runtime.config.redirectUri,
        codeChallenge: prepared.challenge,
        codeChallengeMethod: 'S256',
        state: prepared.transaction.state,
        scopes: [...runtime.config.scopes],
        flow,
      },
      { signal },
    );
  } catch (error) {
    await discardPrepared(runtime, epoch);
    if (error instanceof TransportError) return { kind: 'transportFailure' };
    if (error instanceof TypeError) return { kind: 'invalidInput' };
    if (error instanceof ApiError) return { kind: 'apiFailure' };
    return { kind: 'apiFailure' };
  }
  if (!runtime.isEpochCurrent(epoch)) return { kind: 'signedOut' };
  const now = runtime.wallTime();
  const serverExpiry = Date.parse(started.expiresAt);
  if (
    !Number.isFinite(serverExpiry) ||
    serverExpiry <= now ||
    !/^[A-Za-z0-9_-]{43}$/.test(started.attemptSecret) ||
    !/^[a-f0-9]{64}$/.test(started.providerNonceDigest)
  ) {
    await discardPrepared(runtime, epoch);
    return { kind: 'apiFailure' };
  }
  const transaction = {
    ...prepared.transaction,
    kind: 'native' as const,
    expiresAt: Math.min(serverExpiry, now + NATIVE_ATTEMPT_LIFETIME_MS),
  };
  if (transactionExpired(transaction, now)) {
    await discardPrepared(runtime, epoch);
    return { kind: 'expired' };
  }
  const existing = runtime.record;
  if (!existing || existing.tokens || existing.transaction?.operationId !== transaction.operationId)
    return { kind: 'signedOut' };
  const pending: PendingAuthRecord = {
    schemaVersion: existing.schemaVersion,
    serverBaseAddress: existing.serverBaseAddress,
    environment: existing.environment,
    clientId: existing.clientId,
    installDigest: existing.installDigest,
    transaction,
    nativeAttempt: {
      id: started.attemptId,
      secret: started.attemptSecret,
      nonceDigest: started.providerNonceDigest,
      flow,
    },
  };
  try {
    if (!(await runtime.replaceRecord(pending, epoch))) return { kind: 'signedOut' };
  } catch {
    runtime.setState(SESSION_STATUS.STORAGE_BLOCKED, AUTH_OPERATION.NONE, {
      reason: 'storageFailure',
    });
    return { kind: 'storageFailure' };
  }
  if (!runtime.isEpochCurrent(epoch)) return { kind: 'signedOut' };
  const { attemptSecret: _secret, providerNonceDigest: _nonce, ...view } = started;
  runtime.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.NONE, { nativeAttempt: view });
  return { kind: 'continue', view };
}

async function discardPrepared(runtime: AuthRuntime, epoch: number): Promise<void> {
  if (!runtime.isEpochCurrent(epoch)) return;
  try {
    await runtime.deleteRecord(epoch);
  } catch {
    runtime.setState(SESSION_STATUS.STORAGE_BLOCKED, AUTH_OPERATION.NONE, {
      reason: 'storageFailure',
    });
    return;
  }
  if (runtime.isEpochCurrent(epoch))
    runtime.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.NONE);
}
