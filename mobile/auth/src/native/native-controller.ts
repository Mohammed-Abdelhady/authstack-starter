import type { ApiClient } from '@app/sdk';
import { ApiError, TransportError } from '@app/sdk';
import { AUTH_OPERATION, SESSION_STATUS } from '../constants';
import { createCallbackProcessor } from '../callbacks/callback-processing';
import { PortAbortController } from '../runtime/abort-controller';
import { PortDeadlineError, withPortDeadline } from '../runtime/deadlines';
import { transactionExpired } from '../storage/persistence';
import type { AuthRuntime } from '../runtime/runtime';
import type { AbortSignalPort, SignInOutcome } from '../types/auth';
import type {
  BrowserSignInOptions,
  NativeController,
  NativeSignInAction,
  NativeSignInOutcome,
} from '../types/native-sign-in';
import { beginNativeAttempt } from './native-start';
import { applyNativeResult } from './native-result';
import { parseNativeEmailCallback } from './native-email-callback';
import { performNativeAction } from './native-actions';
import { createNativeMethodsReader } from './native-methods-reader';
import { createNativeInteractivePrompt } from './native-interactive-prompt';

const NATIVE_CALL_TIMEOUT_MS = 15_000;
const NATIVE_CALLBACK_QUEUE_LIMIT = 16;

export function createNativeController(
  runtime: AuthRuntime,
  client: ApiClient<AbortSignalPort>,
  tokenClient: ApiClient<AbortSignalPort>,
  browserSignIn: (options: BrowserSignInOptions) => Promise<SignInOutcome>,
): NativeController {
  const callbacks = createCallbackProcessor(runtime, tokenClient, client);
  const queuedAddresses: string[] = [];
  let active: PortAbortController | undefined;
  let busy = false;
  runtime.onEpochChange(() => active?.abort());

  const methods = createNativeMethodsReader(runtime, client, NATIVE_CALL_TIMEOUT_MS);
  const prompt = createNativeInteractivePrompt(runtime);

  const nativeSignIn = async (action: NativeSignInAction): Promise<NativeSignInOutcome> => {
    if (runtime.disposed) return { kind: 'disposed' };
    if (busy) return { kind: 'busy' };
    if (runtime.snapshot.status === SESSION_STATUS.SIGNED_IN) return { kind: 'signedOut' };
    if (
      runtime.snapshot.status !== SESSION_STATUS.SIGNED_OUT &&
      runtime.snapshot.status !== SESSION_STATUS.REAUTH_REQUIRED
    )
      return { kind: 'busy' };
    const previousStatus = runtime.snapshot.status;
    busy = true;
    let controller = new PortAbortController();
    active = controller;
    let operationEpoch = runtime.epoch;
    try {
      if (action.kind === 'start') {
        if (runtime.record?.nativeAttempt) {
          const cancelled = await cancelNativeSignIn();
          if (cancelled.kind !== 'cancelled') return cancelled;
          controller = new PortAbortController();
          active = controller;
        }
        const epoch = runtime.bumpEpoch('signIn');
        operationEpoch = epoch;
        controller = new PortAbortController();
        active = controller;
        return await withPortDeadline(
          runtime.dependencies.timer,
          NATIVE_CALL_TIMEOUT_MS,
          () =>
            beginNativeAttempt(
              runtime,
              client,
              action.flow,
              previousStatus,
              epoch,
              controller.signal,
            ),
          'native.start',
          () => controller.abort(),
        );
      }
      const record = runtime.record;
      if (!record?.nativeAttempt || !record.transaction) return { kind: 'signedOut' };
      if (transactionExpired(record.transaction, runtime.wallTime())) {
        await cancelNativeSignIn();
        return { kind: 'expired' };
      }
      const epoch = runtime.epoch;
      const perform = () =>
        performNativeAction(
          {
            runtime,
            client,
            methods,
            cancel: cancelNativeSignIn,
            browserSignIn,
            prompt,
            requestTimeoutMs: NATIVE_CALL_TIMEOUT_MS,
          },
          action,
          controller,
        );
      const answer =
        action.kind === 'provider' || action.kind === 'passkey'
          ? await perform()
          : await withPortDeadline(
              runtime.dependencies.timer,
              NATIVE_CALL_TIMEOUT_MS,
              perform,
              'native.action',
              () => controller.abort(),
            );
      if (runtime.disposed) return { kind: 'disposed' };
      if (!runtime.isEpochCurrent(epoch)) {
        return answer.kind === 'outcome' ? answer.outcome : { kind: 'signedOut' };
      }
      if (answer.kind === 'outcome' && answer.outcome.kind === 'expired') {
        const cancelled = await cancelNativeSignIn();
        return cancelled.kind === 'storageFailure' ? cancelled : answer.outcome;
      }
      if (answer.kind === 'outcome') return answer.outcome;
      const outcome = await applyNativeResult(runtime, callbacks, answer.result, epoch);
      return runtime.disposed ? { kind: 'disposed' } : outcome;
    } catch (error) {
      if (runtime.disposed) return { kind: 'disposed' };
      if (action.kind === 'start' && error instanceof PortDeadlineError) {
        const cancelled = await cancelNativeSignIn();
        return cancelled.kind === 'storageFailure'
          ? { kind: 'storageFailure' }
          : { kind: 'transportFailure' };
      }
      if (!runtime.isEpochCurrent(operationEpoch)) return { kind: 'signedOut' };
      if (error instanceof TransportError) return { kind: 'transportFailure' };
      if (error instanceof ApiError) return { kind: 'apiFailure' };
      if (error instanceof TypeError) return { kind: 'invalidInput' };
      return { kind: 'apiFailure' };
    } finally {
      controller.abort();
      if (active === controller) active = undefined;
      busy = false;
      if (queuedAddresses.length > 0) void processInitialAddress();
    }
  };

  const cancelNativeSignIn = async (): Promise<NativeSignInOutcome> => {
    if (runtime.disposed) return { kind: 'disposed' };
    if (!active && !runtime.record?.nativeAttempt) return { kind: 'cancelled' };
    active?.abort();
    const previous = runtime.record;
    const epoch = runtime.bumpEpoch('signIn');
    if (!previous?.nativeAttempt && !previous?.transaction) return { kind: 'cancelled' };
    try {
      const deleted = await runtime.deleteRecordGuarded(epoch, {
        kind: 'authorization',
        operationId: previous.transaction?.operationId ?? '',
      });
      if (!deleted) return { kind: 'signedOut' };
    } catch {
      return { kind: 'storageFailure' };
    }
    if (runtime.isEpochCurrent(epoch)) {
      runtime.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.NONE);
      if (previous.nativeAttempt)
        void client.nativeAuth
          .cancel({ id: previous.nativeAttempt.id, secret: previous.nativeAttempt.secret })
          .catch(() => undefined);
    }
    return { kind: 'cancelled' };
  };

  const handleAddress = async (address: string): Promise<boolean> => {
    if (runtime.disposed) return false;
    if (runtime.snapshot.status === SESSION_STATUS.RESTORING) {
      if (queuedAddresses.length < NATIVE_CALLBACK_QUEUE_LIMIT && address.length <= 4096)
        queuedAddresses.push(address);
      return false;
    }
    const callback = parseNativeEmailCallback(address, runtime);
    if (!callback) return false;
    if (busy) {
      if (queuedAddresses.length < NATIVE_CALLBACK_QUEUE_LIMIT) queuedAddresses.push(address);
      return true;
    }
    await nativeSignIn({ kind: 'verifyEmailLink', ...callback });
    return true;
  };

  const processInitialAddress = async (address?: string): Promise<void> => {
    const addresses = [...(address === undefined ? [] : [address]), ...queuedAddresses.splice(0)];
    for (const candidate of addresses) {
      if (await handleAddress(candidate)) return;
    }
  };

  const restore = async (epoch: number): Promise<void> => {
    const native = runtime.record?.nativeAttempt;
    const transaction = runtime.record?.transaction;
    if (!native || !transaction || !runtime.isEpochCurrent(epoch)) return;
    if (transactionExpired(transaction, runtime.wallTime())) {
      await cancelNativeSignIn();
      return;
    }
    try {
      const result = await withPortDeadline(
        runtime.dependencies.timer,
        NATIVE_CALL_TIMEOUT_MS,
        () => client.nativeAuth.resume({ id: native.id, secret: native.secret }),
        'native.resume',
      );
      if (runtime.isEpochCurrent(epoch)) await applyNativeResult(runtime, callbacks, result, epoch);
    } catch {
      if (runtime.isEpochCurrent(epoch))
        runtime.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.NONE);
    }
  };

  return {
    needsCancellation: () => Boolean(active || runtime.record?.nativeAttempt),
    methods,
    nativeSignIn,
    cancelNativeSignIn,
    handleAddress,
    processInitialAddress,
    restore,
  };
}
