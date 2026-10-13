import type { NativeAttemptStart, NativeMethods } from '@app/sdk';
import { NATIVE_ATTEMPT_FLOW } from '../constants/native-attempt';

export function isNativeAttemptStart(
  input: unknown,
): input is NativeAttemptStart {
  if (!input || typeof input !== 'object') return false;
  const value = input as Partial<NativeAttemptStart>;
  return (
    Object.values(NATIVE_ATTEMPT_FLOW).some((flow) => flow === value.flow) &&
    Array.isArray(value.scopes) &&
    value.scopes.every((scope) => typeof scope === 'string')
  );
}

export function nativeAttemptFlowAvailable(
  flow: NativeAttemptStart['flow'],
  methods: NativeMethods,
  firstFactorCount: number,
): boolean {
  if (flow === NATIVE_ATTEMPT_FLOW.SIGN_IN) return firstFactorCount > 0;
  if (flow === NATIVE_ATTEMPT_FLOW.REGISTRATION)
    return methods.capabilities.registration;
  if (flow === NATIVE_ATTEMPT_FLOW.RECOVERY)
    return methods.capabilities.recovery;
  return false;
}
