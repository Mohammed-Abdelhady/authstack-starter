import {
  NATIVE_AUTH_LIMITS,
  NATIVE_AUTH_PATTERN,
  areAllPasswordRulesPassed,
  isPasswordWithinByteLimit,
} from '@app/core';

export function validNativeEmail(email: string): boolean {
  return email.length <= NATIVE_AUTH_LIMITS.EMAIL && NATIVE_AUTH_PATTERN.EMAIL.test(email);
}
export function validNativePassword(password: string, creating = false): boolean {
  return (
    password.trim().length > 0 &&
    isPasswordWithinByteLimit(password) &&
    (!creating || areAllPasswordRulesPassed(password))
  );
}
