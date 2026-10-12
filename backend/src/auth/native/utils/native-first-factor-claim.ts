import {
  NATIVE_ATTEMPT_FIRST_FACTOR,
  NATIVE_ATTEMPT_PHASE,
} from '../constants/native-attempt';
import type {
  NativeAttempt,
  VerifiedNativePrincipal,
} from '../types/native-attempt';

export function isFirstFactorClaim(
  attempt: NativeAttempt,
  principal: VerifiedNativePrincipal,
): boolean {
  switch (attempt.phase) {
    case NATIVE_ATTEMPT_PHASE.FIRST_FACTOR_REQUIRED:
      return [
        NATIVE_ATTEMPT_FIRST_FACTOR.PASSWORD,
        NATIVE_ATTEMPT_FIRST_FACTOR.PROVIDER,
        NATIVE_ATTEMPT_FIRST_FACTOR.PASSKEY,
        NATIVE_ATTEMPT_FIRST_FACTOR.EMAIL_LINK,
      ].some((factor) => factor === principal.firstFactor);
    case NATIVE_ATTEMPT_PHASE.EMAIL_LINK_SENT:
      return principal.firstFactor === NATIVE_ATTEMPT_FIRST_FACTOR.EMAIL_LINK;
    case NATIVE_ATTEMPT_PHASE.REGISTRATION_CODE_REQUIRED:
      return principal.firstFactor === NATIVE_ATTEMPT_FIRST_FACTOR.EMAIL_CODE;
    default:
      return false;
  }
}
