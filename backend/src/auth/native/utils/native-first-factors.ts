import type { NativeFirstFactor, NativeMethods } from '@app/sdk';
import { NATIVE_ATTEMPT_FIRST_FACTOR } from '../constants/native-attempt';

export function nativeFirstFactors(
  methods: NativeMethods,
): NativeFirstFactor[] {
  const factors: NativeFirstFactor[] = [];
  if (methods.capabilities.password)
    factors.push(NATIVE_ATTEMPT_FIRST_FACTOR.PASSWORD);
  if (methods.capabilities.emailLink)
    factors.push(NATIVE_ATTEMPT_FIRST_FACTOR.EMAIL_LINK);
  if (methods.capabilities.passkeys)
    factors.push(NATIVE_ATTEMPT_FIRST_FACTOR.PASSKEY);
  if (methods.providers.some(({ mode }) => mode !== 'system'))
    factors.push(NATIVE_ATTEMPT_FIRST_FACTOR.PROVIDER);
  // feature:email-code:start
  if (methods.capabilities.emailCode === true)
    factors.push(NATIVE_ATTEMPT_FIRST_FACTOR.EMAIL_CODE);
  // feature:email-code:end
  return factors;
}
