import type {
  NativeAttempt,
  NativeAttemptGuard,
  NativeAttemptOperationGuard,
} from '../types/native-attempt';
import { wrongStage } from './native-attempt-errors';

export function guardOf(attempt: NativeAttempt): NativeAttemptGuard {
  return {
    attemptId: attempt.attemptId,
    clientId: attempt.clientId,
    secretHash: attempt.secretHash,
    revision: attempt.revision,
  };
}

export function operationGuardOf(
  attempt: NativeAttempt,
): NativeAttemptOperationGuard {
  if (!attempt.activeOperationId) throw wrongStage();
  return { ...guardOf(attempt), operationId: attempt.activeOperationId };
}
