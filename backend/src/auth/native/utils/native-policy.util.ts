import type { NativeAttempt } from '../types/native-attempt';
import type { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { featureDisabled, wrongStage } from './native-attempt-errors';

export function assertNativeEnabled(epoch: AuthEpochService): void {
  if (!epoch.nativeEnabled()) throw featureDisabled();
}

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
