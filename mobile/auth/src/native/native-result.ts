import type { NativeAttemptResult } from '@app/sdk';
import { AUTH_OPERATION, SESSION_STATUS } from '../constants';
import { createCallbackProcessor } from '../callbacks/callback-processing';
import { parseCallback, parseUri } from '../sign-in/redirect';
import { constantTimeEqual, transactionExpired } from '../storage/persistence';
import type { AuthRuntime } from '../runtime/runtime';
import type { NativeSignInOutcome } from '../types/native-sign-in-actions';

type CallbackProcessor = ReturnType<typeof createCallbackProcessor>;

export async function applyNativeResult(
  runtime: AuthRuntime,
  callbacks: CallbackProcessor,
  result: NativeAttemptResult,
  epoch: number,
): Promise<NativeSignInOutcome> {
  const record = runtime.record;
  const native = record?.nativeAttempt;
  const transaction = record?.transaction;
  if (!runtime.isEpochCurrent(epoch) || !native || !transaction) return { kind: 'signedOut' };
  if (transactionExpired(transaction, runtime.wallTime())) return { kind: 'expired' };
  if (result.attemptId !== native.id) return { kind: 'apiFailure' };
  const serverExpiry = Date.parse(result.expiresAt);
  if (!Number.isFinite(serverExpiry) || serverExpiry <= runtime.wallTime())
    return { kind: 'expired' };
  const activationCompleted =
    native.activationCompleted === true ||
    ('activationCompleted' in result && result.activationCompleted === true);
  if (activationCompleted && !native.activationCompleted && result.stage !== 'codeReady') {
    try {
      if (
        !(await runtime.replaceRecord(
          { ...record, nativeAttempt: { ...native, activationCompleted: true } },
          epoch,
        ))
      )
        return { kind: 'signedOut' };
    } catch {
      return { kind: 'storageFailure' };
    }
  }
  if (result.stage === 'codeReady') {
    const expected = parseUri(transaction.returnAddress);
    if (!expected) return { kind: 'apiFailure' };
    const parsed = parseCallback(result.redirectUri, expected);
    if (parsed.kind !== 'code' || !constantTimeEqual(parsed.state, transaction.state))
      return { kind: 'apiFailure' };
    const outcome = await callbacks.processAddress(result.redirectUri);
    if (outcome.kind === 'signedIn') return outcome;
    if (outcome.kind === 'disposed') return { kind: 'disposed' };
    if (activationCompleted) return { kind: 'activationCompleted' };
    if (outcome.kind === 'storageFailure') return { kind: 'storageFailure' };
    if (outcome.kind === 'transportFailure') return { kind: 'transportFailure' };
    return { kind: 'apiFailure' };
  }
  if (result.stage === 'denied' || result.stage === 'recoveryComplete') {
    if (result.stage === 'recoveryComplete' && result.passwordUpdated !== true)
      return { kind: 'apiFailure' };
    try {
      if (!(await runtime.deleteRecord(epoch))) return { kind: 'signedOut' };
    } catch {
      return { kind: 'storageFailure' };
    }
    if (runtime.isEpochCurrent(epoch))
      runtime.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.NONE);
    return result.stage === 'recoveryComplete'
      ? { kind: 'recoveryComplete' }
      : { kind: 'cancelled' };
  }
  runtime.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.NONE, { nativeAttempt: result });
  return activationCompleted
    ? { kind: 'activationCompleted', view: result }
    : { kind: 'continue', view: result };
}
