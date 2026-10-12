import type { NativeAttempt } from '../types/native-attempt';
import { wrongStage } from './native-attempt-errors';

export function assertNativePolicy(
  attempt: NativeAttempt,
  currentHash: string | null,
  currentEpoch: number,
): void {
  if (
    !currentHash ||
    attempt.details.policyHash !== currentHash ||
    attempt.authEpoch !== currentEpoch
  )
    throw wrongStage();
}
