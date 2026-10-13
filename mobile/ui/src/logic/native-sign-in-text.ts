import type { NativeSignInOutcome } from '@app/native-auth';
import type { MessageKey } from '../i18n';

const OUTCOME_MESSAGE: Record<NativeSignInOutcome['kind'], MessageKey | undefined> = {
  continue: undefined,
  signedIn: undefined,
  activationCompleted: 'native.activationCompleted',
  recoveryComplete: 'native.recoveryComplete',
  cancelled: 'native.cancelled',
  expired: 'signIn.failed.expired',
  unavailable: 'native.unavailable',
  busy: undefined,
  invalidInput: 'native.invalidInput',
  storageFailure: 'signIn.failed.storage',
  apiFailure: 'native.refused',
  transportFailure: 'common.offline',
  disabled: 'signIn.failed.disabled',
  disposed: undefined,
  signedOut: 'native.startAgain',
};
export function nativeOutcomeMessage(outcome: NativeSignInOutcome): MessageKey | undefined {
  return OUTCOME_MESSAGE[outcome.kind];
}
