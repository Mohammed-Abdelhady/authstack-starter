import {
  NATIVE_ATTEMPT_FIRST_FACTOR,
  NATIVE_ATTEMPT_FLOW,
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
      if (attempt.flow !== NATIVE_ATTEMPT_FLOW.SIGN_IN) return false;
      return [
        NATIVE_ATTEMPT_FIRST_FACTOR.PASSWORD,
        NATIVE_ATTEMPT_FIRST_FACTOR.PROVIDER,
        NATIVE_ATTEMPT_FIRST_FACTOR.PASSKEY,
        NATIVE_ATTEMPT_FIRST_FACTOR.EMAIL_LINK,
      ].some((factor) => factor === principal.firstFactor);
    case NATIVE_ATTEMPT_PHASE.EMAIL_LINK_SENT:
      if (attempt.flow !== NATIVE_ATTEMPT_FLOW.SIGN_IN) return false;
      return [
        NATIVE_ATTEMPT_FIRST_FACTOR.EMAIL_LINK,
        NATIVE_ATTEMPT_FIRST_FACTOR.EMAIL_CODE, // feature:email-code
      ].some((factor) => factor === principal.firstFactor);
    case NATIVE_ATTEMPT_PHASE.REGISTRATION_CODE_REQUIRED:
      return (
        attempt.flow === NATIVE_ATTEMPT_FLOW.REGISTRATION &&
        principal.firstFactor === NATIVE_ATTEMPT_FIRST_FACTOR.EMAIL_CODE
      );
    default:
      return false;
  }
}
