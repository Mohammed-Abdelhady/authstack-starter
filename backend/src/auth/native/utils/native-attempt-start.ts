import type { NativeAttemptStart } from '@app/sdk';
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
