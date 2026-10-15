import type { ApiClient } from '@app/sdk';
import { BROWSER_AUTHORIZATION_TIMEOUT_MS, AUTH_OPERATION, SESSION_STATUS } from '../constants';
import { PortAbortController } from '../runtime/abort-controller';
import { matchesRedirectDestination } from './redirect';
import { authorizationAddress, validBrowserSignInOptions } from './browser-options';
import { callbackRejectionReason, createCallbackProcessor } from '../callbacks/callback-processing';
import { revokeQuietly } from '../sign-out/revocation';
import { deferredOutcome, waitForEpochChange, type DeferredOutcome } from './sign-in-waiters';
import { prepareSignIn } from './sign-in-transaction';
import {
  asSignInError,
  cancelSignInDeadline,
  isCallbackAddress,
  matchesTransactionState,
  queueRestoringAddress,
} from './sign-in-utils';
import type { AuthRuntime } from '../runtime/runtime';
import type { AuthTransaction } from '../types/record';
import type { AbortSignalPort, SessionStatus, SignInOutcome } from '../types/auth';
import type { BrowserSignInOptions } from '../types/native-sign-in-actions';

export interface SignInController {
  signIn(options?: BrowserSignInOptions): Promise<SignInOutcome>;
  handleAddress(address: string): Promise<void>;
  processInitialAddress(address?: string): Promise<void>;
}

export function createSignInController(
  runtime: AuthRuntime,
  client: ApiClient<AbortSignalPort>,
  revocationClient: ApiClient<AbortSignalPort>,
): SignInController {
  let callbackWaiter: DeferredOutcome | undefined;
  let callbackStarted = false;
  let authorizationActive = false;
  let acceptCallback: (() => void) | undefined;
  const queuedAddresses: string[] = [];
  let deadTransactionId: string | undefined;
  const callbacks = createCallbackProcessor(runtime, client, revocationClient);

  const handleAddress = (address: string): Promise<void> => {
    if (runtime.disposed) return Promise.resolve();
    const currentTransaction = runtime.record?.transaction;
    if (currentTransaction && deadTransactionId === currentTransaction.operationId)
      return Promise.resolve();
    if (runtime.snapshot.status === SESSION_STATUS.RESTORING) {
      const returnAddress = runtime.record?.transaction?.returnAddress;
      if (
        (returnAddress && matchesRedirectDestination(address, returnAddress)) ||
        (!returnAddress && isCallbackAddress(address))
      ) {
        queueRestoringAddress(queuedAddresses, address, runtime.record?.transaction);
      }
      return Promise.resolve();
    }
    const canContinueSavedTransaction =
      runtime.record?.transaction !== undefined &&
      runtime.snapshot.status === SESSION_STATUS.SIGNED_OUT;
    if (!authorizationActive && !canContinueSavedTransaction) return Promise.resolve();
    if (!runtime.record?.transaction) return Promise.resolve();
    const waiter = callbackWaiter;
    const accept = acceptCallback;
    return callbacks
      .processAddress(address, () => {
        callbackStarted = true;
        accept?.();
      })
      .then(
        (outcome) => {
          if (outcome.kind !== 'ignored') waiter?.resolve(outcome);
        },
        (error: unknown) => {
          waiter?.resolve({ kind: 'browserFailure', reason: asSignInError(error).message });
        },
      );
  };

  const processInitialAddress = async (address?: string): Promise<void> => {
    const queued = queuedAddresses.splice(0);
    if (!runtime.record?.transaction) return;
    const addresses = [...(address === undefined ? [] : [address]), ...queued].filter((candidate) =>
      matchesTransactionState(candidate, runtime.record?.transaction),
    );
    for (const candidate of addresses) {
      if (!runtime.record?.transaction) return;
      if (deadTransactionId === runtime.record.transaction.operationId) return;
      await callbacks.processAddress(candidate);
    }
  };

  const signIn = (options?: BrowserSignInOptions): Promise<SignInOutcome> => {
    if (runtime.disposed) return Promise.resolve({ kind: 'disposed' });
    if (!validBrowserSignInOptions(options))
      return Promise.resolve({ kind: 'browserFailure', reason: 'invalidOptions' });
    if (runtime.signInPromise) return runtime.signInPromise;
    if (runtime.snapshot.status === SESSION_STATUS.SIGNED_IN)
      return Promise.resolve({ kind: 'alreadySignedIn' });
    if (
      runtime.snapshot.operation !== AUTH_OPERATION.NONE ||
      (runtime.snapshot.status !== SESSION_STATUS.SIGNED_OUT &&
        runtime.snapshot.status !== SESSION_STATUS.REAUTH_REQUIRED)
    ) {
      return Promise.resolve({ kind: 'signedOut' });
    }
    const previousStatus = runtime.snapshot.status;
    const savedOperationId = runtime.record?.transaction?.operationId;
    if (savedOperationId) deadTransactionId = savedOperationId;
    const epoch = runtime.bumpEpoch('signIn');
    const epochWait = waitForEpochChange(runtime);
    const running = Promise.race([
      Promise.resolve().then(() => runSignIn(epoch, previousStatus, savedOperationId, options)),
      epochWait.promise.then(() => ({ kind: 'signedOut' as const })),
    ]).finally(epochWait.cancel);
    const pending = runtime.raceWithDispose(running, () => ({ kind: 'disposed' as const }));
    runtime.signInPromise = pending;
    runtime.setState(previousStatus, AUTH_OPERATION.AUTHORIZING);
    void pending.then(
      () => {
        if (runtime.signInPromise === pending) runtime.signInPromise = undefined;
      },
      () => {
        if (runtime.signInPromise === pending) runtime.signInPromise = undefined;
      },
    );
    return pending;
  };

  async function runSignIn(
    epoch: number,
    previousStatus: SessionStatus,
    savedOperationId?: string,
    options?: BrowserSignInOptions,
  ): Promise<SignInOutcome> {
    if (!runtime.isEpochCurrent(epoch)) return { kind: 'signedOut' };
    if (
      previousStatus !== SESSION_STATUS.SIGNED_OUT &&
      previousStatus !== SESSION_STATUS.REAUTH_REQUIRED
    )
      return { kind: 'signedOut' };
    if (previousStatus === SESSION_STATUS.REAUTH_REQUIRED) {
      const oldRefreshToken = runtime.record?.tokens?.refreshToken;
      if (oldRefreshToken) {
        void revokeQuietly(
          revocationClient,
          runtime.dependencies,
          oldRefreshToken,
          runtime.config.clientId,
          runtime.record?.proofKeyThumbprint === undefined
            ? undefined
            : {
                serverBaseAddress: runtime.config.serverBaseAddress,
                proofKeyThumbprint: runtime.record.proofKeyThumbprint,
              },
        ).catch(() => undefined);
      }
    }
    if (savedOperationId) {
      try {
        const deleted = await runtime.deleteRecord(epoch);
        if (!runtime.isEpochCurrent(epoch)) return { kind: 'signedOut' };
        if (!deleted) return { kind: 'signedOut' };
        if (deadTransactionId === savedOperationId) deadTransactionId = undefined;
      } catch (error) {
        if (!runtime.isEpochCurrent(epoch)) return { kind: 'signedOut' };
        runtime.setState(SESSION_STATUS.STORAGE_BLOCKED, AUTH_OPERATION.NONE, {
          reason: 'storageFailure',
        });
        return { kind: 'storageFailure', error: asSignInError(error) };
      }
    }
    const prepared = await prepareSignIn(runtime, epoch, previousStatus);
    if (prepared.kind === 'outcome') return prepared.outcome;
    return openBrowser(prepared.transaction, previousStatus, epoch, prepared.challenge, options);
  }

  async function openBrowser(
    transaction: AuthTransaction,
    previousStatus: 'signedOut' | 'reauthRequired',
    epoch: number,
    challenge: string,
    options?: BrowserSignInOptions,
  ): Promise<SignInOutcome> {
    const controller = new PortAbortController();
    runtime.browserAbort = controller;
    const waiter = deferredOutcome();
    callbackWaiter = waiter;
    callbackStarted = false;
    authorizationActive = true;
    let expire: (() => void) | undefined;
    const accept = (): void => {
      authorizationActive = false;
      if (expire) {
        cancelSignInDeadline(expire);
        expire = undefined;
      }
      runtime.cancelAuthorizationDeadline = undefined;
    };
    acceptCallback = accept;
    let resolveExpired: (result: { kind: 'deadline' }) => void = () => undefined;
    const expired = new Promise<{ kind: 'deadline' }>((resolve) => {
      resolveExpired = resolve;
    });
    try {
      expire = runtime.dependencies.timer.after(BROWSER_AUTHORIZATION_TIMEOUT_MS, () => {
        authorizationActive = false;
        controller.abort();
        resolveExpired({ kind: 'deadline' });
      });
      runtime.cancelAuthorizationDeadline = expire;
    } catch (error) {
      authorizationActive = false;
      controller.abort();
      const outcome = await discardAndRestore(transaction, previousStatus, epoch, {
        kind: 'browserFailure',
        reason: asSignInError(error).message,
      });
      if (callbackWaiter === waiter) callbackWaiter = undefined;
      if (acceptCallback === accept) acceptCallback = undefined;
      if (runtime.browserAbort === controller) runtime.browserAbort = undefined;
      return outcome;
    }
    const browserResult = Promise.resolve()
      .then(() =>
        runtime.dependencies.authBrowser.open(
          authorizationAddress(runtime.config, challenge, transaction.state, options),
          transaction.returnAddress,
          controller.signal,
        ),
      )
      .then((result) => ({ kind: 'browser' as const, result }))
      .catch((error: unknown) => ({ kind: 'failed' as const, error }));
    const callbackResult = waiter.promise.then((outcome) => ({
      kind: 'callback' as const,
      outcome,
    }));
    const epochWait = waitForEpochChange(runtime);
    try {
      const first = await Promise.race([browserResult, callbackResult, expired, epochWait.promise]);
      if (!runtime.isEpochCurrent(epoch)) return { kind: 'signedOut' };
      if (first.kind === 'callback') return first.outcome;
      if (first.kind === 'deadline')
        return discardAndRestore(transaction, previousStatus, epoch, { kind: 'expired' });
      if (first.kind === 'epochChanged') return { kind: 'signedOut' };
      if (callbackStarted) return waiter.promise;
      if (first.kind === 'failed')
        return discardAndRestore(transaction, previousStatus, epoch, {
          kind: 'browserFailure',
          reason: asSignInError(first.error).message,
        });
      if (first.kind === 'browser' && first.result.kind === 'failed') {
        authorizationActive = false;
        return discardAndRestore(transaction, previousStatus, epoch, {
          kind: 'browserFailure',
          reason: first.result.reason,
        });
      }
      if (first.kind === 'browser' && first.result.kind === 'redirect') {
        const outcome = await callbacks.processAddress(first.result.url, () => {
          callbackStarted = true;
          accept();
        });
        if (outcome.kind !== 'ignored') return outcome;
        authorizationActive = false;
        accept();
        return discardAndRestore(transaction, previousStatus, epoch, {
          kind: 'invalidCallback',
          reason: callbackRejectionReason(first.result.url, transaction),
        });
      }
      if (first.kind !== 'browser') return { kind: 'signedOut' };
      authorizationActive = false;
      const outcome = await discardAndRestore(
        transaction,
        previousStatus,
        epoch,
        first.result.kind === 'cancelled' ? { kind: 'cancelled' } : { kind: 'dismissed' },
      );
      return outcome;
    } catch (error) {
      if (!runtime.isEpochCurrent(epoch)) return { kind: 'signedOut' };
      authorizationActive = false;
      return discardAndRestore(transaction, previousStatus, epoch, {
        kind: 'browserFailure',
        reason: asSignInError(error).message,
      });
    } finally {
      epochWait.cancel();
      controller.abort();
      if (expire) cancelSignInDeadline(expire);
      runtime.cancelAuthorizationDeadline = undefined;
      if (runtime.browserAbort === controller) runtime.browserAbort = undefined;
      if (callbackWaiter === waiter) callbackWaiter = undefined;
      if (acceptCallback === accept) acceptCallback = undefined;
      authorizationActive = false;
      callbackStarted = false;
    }
  }

  async function discardAndRestore(
    transaction: AuthTransaction,
    previousStatus: 'signedOut' | 'reauthRequired',
    epoch: number,
    outcome: SignInOutcome,
  ): Promise<SignInOutcome> {
    deadTransactionId = transaction.operationId;
    const discarded = await callbacks.discardTransaction(transaction, epoch);
    if (!runtime.isEpochCurrent(epoch) || discarded.kind === 'stale') return { kind: 'signedOut' };
    if (discarded.kind === 'storageFailure')
      return { kind: 'storageFailure', error: discarded.error };
    if (deadTransactionId === transaction.operationId) deadTransactionId = undefined;
    callbacks.restorePriorState(previousStatus);
    return outcome;
  }

  return { signIn, handleAddress, processInitialAddress };
}
