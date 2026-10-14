import { API_PATHS, OAuthError } from '@app/sdk';
import type { ApiClient } from '@app/sdk';
import {
  AUTH_OPERATION,
  AUTH_REASON,
  CRYPTO_RANDOM_TIMEOUT_MS,
  OAUTH_EXCHANGE_TIMEOUT_MS,
  PORT_OPERATION,
  SESSION_LINEAGE_BYTES,
  SESSION_STATUS,
} from '../constants';
import { isDeviceBindingRequired, oauthFailureReason } from '../errors/failure';
import { parseCallback, parseUri } from '../sign-in/redirect';
import { constantTimeEqual, transactionExpired } from '../storage/persistence';
import { withNetworkDeadline, withPortDeadline } from '../runtime/deadlines';
import { base64UrlEncode } from '../proof/encoding';
import { requestWithDpopNonceRetry } from '../proof/dpop-requests';
import { createLateTokenRevoker } from './callback-late-revocation';
import { readExchangedProfile } from './callback-profile';
import { asError, exchangeFailureOutcome } from './callback-outcomes';
import type { AuthRuntime } from '../runtime/runtime';
import type { PendingAuthRecord, SessionAuthRecord, AuthTransaction } from '../types/record';
import type {
  AbortSignalPort,
  InvalidCallbackReason,
  SessionStatus,
  SignInOutcome,
} from '../types/auth';
import type { CallbackResult } from '../sign-in/redirect';

export interface CallbackProcessor {
  processAddress(address: string, onAccepted?: () => void): Promise<CallbackProcessingOutcome>;
  discardTransaction(
    transaction: AuthTransaction,
    epoch: number,
  ): Promise<{ kind: 'discarded' | 'stale' } | { kind: 'storageFailure'; error: Error }>;
  restorePriorState(status: SessionStatus): void;
}

export type CallbackProcessingOutcome = SignInOutcome | { kind: 'ignored' };

export function callbackRejectionReason(
  address: string,
  transaction: AuthTransaction,
): InvalidCallbackReason {
  const expected = parseUri(transaction.returnAddress);
  if (!expected) return 'malformed';
  const callback = parseCallback(address, expected);
  if (callback.kind === 'invalid') return callback.reason;
  return constantTimeEqual(callback.state, transaction.state)
    ? 'invalidParameters'
    : 'stateMismatch';
}

export function createCallbackProcessor(
  runtime: AuthRuntime,
  client: ApiClient<AbortSignalPort>,
  revocationClient: ApiClient<AbortSignalPort> = client,
): CallbackProcessor {
  const processing = new Map<string, Promise<CallbackProcessingOutcome>>();

  const processAddress = async (
    address: string,
    onAccepted?: () => void,
  ): Promise<CallbackProcessingOutcome> => {
    const transaction = runtime.record?.transaction;
    if (!transaction) return { kind: 'signedOut' };
    const callback = acceptedCallback(address, transaction);
    if (!callback) return { kind: 'ignored' };
    const inProgress = processing.get(transaction.operationId);
    if (inProgress) return inProgress;
    const task = consumeAndExchange(callback, transaction, runtime.epoch, onAccepted);
    processing.set(transaction.operationId, task);
    try {
      return await task;
    } finally {
      processing.delete(transaction.operationId);
    }
  };

  async function consumeAndExchange(
    callback: Extract<CallbackResult, { kind: 'code' | 'error' }>,
    transaction: AuthTransaction,
    epoch: number,
    onAccepted?: () => void,
  ): Promise<CallbackProcessingOutcome> {
    const previousStatus = runtime.snapshot.status;
    const record = runtime.record;
    if (
      !runtime.isEpochCurrent(epoch) ||
      !record?.transaction ||
      record.transaction.operationId !== transaction.operationId
    ) {
      return { kind: 'signedOut' };
    }
    onAccepted?.();
    let wallTime: number;
    try {
      wallTime = runtime.wallTime();
    } catch (error) {
      const discarded = await discardTransaction(transaction, epoch);
      if (discarded.kind === 'stale') return { kind: 'signedOut' };
      if (discarded.kind === 'storageFailure')
        return { kind: 'storageFailure', error: discarded.error };
      restorePriorState(previousStatus);
      return { kind: 'clockFailure', error: asError(error) };
    }
    if (transactionExpired(transaction, wallTime)) {
      const discarded = await discardTransaction(transaction, epoch);
      if (discarded.kind === 'stale') return { kind: 'signedOut' };
      if (discarded.kind === 'storageFailure')
        return { kind: 'storageFailure', error: discarded.error };
      restorePriorState(previousStatus);
      return { kind: 'expired' };
    }
    const consumed: PendingAuthRecord = {
      schemaVersion: record.schemaVersion,
      serverBaseAddress: record.serverBaseAddress,
      environment: record.environment,
      clientId: record.clientId,
      installDigest: record.installDigest,
      authorizationOperationId: transaction.operationId,
    };
    try {
      const written = await runtime.replaceRecord(consumed, epoch);
      if (!written || !runtime.isEpochCurrent(epoch)) return { kind: 'signedOut' };
    } catch (error) {
      if (!runtime.isEpochCurrent(epoch)) return { kind: 'signedOut' };
      runtime.setState(SESSION_STATUS.STORAGE_BLOCKED, AUTH_OPERATION.NONE, {
        reason: AUTH_REASON.STORAGE_FAILURE,
      });
      return { kind: 'storageFailure', error: asError(error) };
    }
    if (callback.kind === 'error') {
      await runtime.deleteRecord(epoch).catch(() => false);
      if (!runtime.isEpochCurrent(epoch)) return { kind: 'signedOut' };
      runtime.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.NONE, {
        reason: AUTH_REASON.AUTHORIZATION_DENIED,
      });
      return { kind: 'authorizationDenied', error: callback.error };
    }
    runtime.setState(previousStatus, AUTH_OPERATION.EXCHANGING);
    return exchangeCode(callback.code, transaction, consumed, epoch);
  }

  async function exchangeCode(
    code: string,
    transaction: AuthTransaction,
    consumed: PendingAuthRecord,
    epoch: number,
  ): Promise<SignInOutcome> {
    const revokeLateToken = createLateTokenRevoker(
      runtime,
      revocationClient,
      consumed.installDigest,
    );
    let lineageId: string;
    try {
      const lineageBytes = await withPortDeadline(
        runtime.dependencies.timer,
        CRYPTO_RANDOM_TIMEOUT_MS,
        () => runtime.dependencies.crypto.randomBytes(SESSION_LINEAGE_BYTES),
        PORT_OPERATION.CRYPTO_RANDOM_BYTES,
      );
      if (lineageBytes.length !== SESSION_LINEAGE_BYTES)
        throw new TypeError('Session lineage randomness has an unexpected length');
      lineageId = base64UrlEncode(lineageBytes);
    } catch (error) {
      if (!runtime.isEpochCurrent(epoch)) return { kind: 'signedOut' };
      runtime.tokens = undefined;
      await runtime.deleteRecord(epoch).catch(() => false);
      if (!runtime.isEpochCurrent(epoch)) return { kind: 'signedOut' };
      runtime.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.NONE);
      return { kind: 'cryptoFailure', error: asError(error) };
    }
    try {
      const exchange = await withNetworkDeadline(
        runtime.dependencies.timer,
        OAUTH_EXCHANGE_TIMEOUT_MS,
        async (signal) => {
          const input = {
            code,
            codeVerifier: transaction.verifier,
            redirectUri: transaction.returnAddress,
            clientId: runtime.config.clientId,
          };
          if (!runtime.dependencies.deviceKey) {
            return {
              tokens: await client.oauth.exchangeCode(input, { signal }),
              proofKeyThumbprint: undefined,
            };
          }
          const proof = await requestWithDpopNonceRetry(
            {
              ...runtime.dependencies,
              serverBaseAddress: runtime.config.serverBaseAddress,
              method: 'POST',
              path: API_PATHS.oauth.token,
              signal,
              mayRetryChallenge: () => runtime.isEpochCurrent(epoch) && !runtime.disposed,
            },
            ({ headers }) => client.oauth.exchangeCode(input, { headers, signal }),
          );
          return { tokens: proof.value, proofKeyThumbprint: proof.thumbprint };
        },
        (lateExchange) => {
          void revokeLateToken(
            lateExchange.tokens.refreshToken,
            lineageId,
            lateExchange.proofKeyThumbprint,
          ).catch(() => undefined);
        },
      );
      const tokens = exchange.tokens;
      const proofKeyThumbprint = exchange.proofKeyThumbprint;
      if (!runtime.isEpochCurrent(epoch)) {
        await revokeLateToken(tokens.refreshToken, lineageId, proofKeyThumbprint);
        return { kind: 'signedOut' };
      }
      const sentAt = runtime.lastOAuthTokenSentAt ?? runtime.monotonicTime();
      runtime.installTokens(
        tokens.accessToken,
        tokens.refreshToken,
        sentAt,
        tokens.expiresIn,
        lineageId,
        proofKeyThumbprint,
      );
      const tokenRecord: SessionAuthRecord = {
        schemaVersion: consumed.schemaVersion,
        serverBaseAddress: consumed.serverBaseAddress,
        environment: consumed.environment,
        clientId: consumed.clientId,
        installDigest: consumed.installDigest,
        lineageId,
        tokens: { refreshToken: tokens.refreshToken },
        ...(proofKeyThumbprint === undefined ? {} : { proofKeyThumbprint }),
      };
      try {
        const written = await runtime.replaceRecord(
          tokenRecord,
          epoch,
          // Every path that abandons this write revokes the token, so a late landing is removed.
          { kind: 'delete' },
          {
            kind: 'session',
            installDigest: consumed.installDigest,
            refreshToken: tokens.refreshToken,
            lineageId,
          },
        );
        if (!written) {
          await revokeLateToken(tokens.refreshToken, lineageId, proofKeyThumbprint);
          return { kind: 'signedOut' };
        }
      } catch (error) {
        if (!runtime.isEpochCurrent(epoch)) {
          if (runtime.disposed)
            await revokeLateToken(tokens.refreshToken, lineageId, proofKeyThumbprint);
          return { kind: 'signedOut' };
        }
        runtime.tokens = undefined;
        await revokeLateToken(tokens.refreshToken, lineageId, proofKeyThumbprint);
        runtime.setState(SESSION_STATUS.STORAGE_BLOCKED, AUTH_OPERATION.NONE, {
          reason: AUTH_REASON.STORAGE_FAILURE,
        });
        return { kind: 'storageFailure', error: asError(error) };
      }
      return await readExchangedProfile(
        runtime,
        client,
        tokens.refreshToken,
        lineageId,
        proofKeyThumbprint,
        epoch,
        revokeLateToken,
      );
    } catch (error) {
      if (!runtime.isEpochCurrent(epoch)) return { kind: 'signedOut' };
      runtime.tokens = undefined;
      await runtime.deleteRecord(epoch).catch(() => false);
      if (!runtime.isEpochCurrent(epoch)) return { kind: 'signedOut' };
      const outcome = exchangeFailureOutcome(error);
      const reason =
        error instanceof OAuthError
          ? isDeviceBindingRequired(error)
            ? AUTH_REASON.DEVICE_BINDING_REQUIRED
            : oauthFailureReason(error)
          : undefined;
      runtime.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.NONE, reason ? { reason } : {});
      return outcome;
    }
  }

  async function discardTransaction(
    transaction: AuthTransaction,
    epoch: number,
  ): Promise<{ kind: 'discarded' | 'stale' } | { kind: 'storageFailure'; error: Error }> {
    const record = runtime.record;
    if (!record?.transaction || record.transaction.operationId !== transaction.operationId) {
      return runtime.isEpochCurrent(epoch) ? { kind: 'discarded' } : { kind: 'stale' };
    }
    try {
      const deleted = await runtime.deleteRecordGuarded(epoch, {
        kind: 'authorization',
        operationId: transaction.operationId,
      });
      return deleted ? { kind: 'discarded' } : { kind: 'stale' };
    } catch (error) {
      if (!runtime.isEpochCurrent(epoch)) return { kind: 'stale' };
      runtime.setState(SESSION_STATUS.STORAGE_BLOCKED, AUTH_OPERATION.NONE, {
        reason: AUTH_REASON.STORAGE_FAILURE,
      });
      return {
        kind: 'storageFailure',
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  function restorePriorState(status: SessionStatus): void {
    const nextStatus = status === SESSION_STATUS.RESTORING ? SESSION_STATUS.SIGNED_OUT : status;
    runtime.setState(nextStatus, AUTH_OPERATION.NONE);
  }

  return { processAddress, discardTransaction, restorePriorState };
}

function acceptedCallback(
  address: string,
  transaction: AuthTransaction,
): Extract<CallbackResult, { kind: 'code' | 'error' }> | undefined {
  const expected = parseUri(transaction.returnAddress);
  if (!expected) return undefined;
  const callback = parseCallback(address, expected);
  if (callback.kind === 'invalid' || !constantTimeEqual(callback.state, transaction.state)) {
    return undefined;
  }
  return callback;
}
