import {
  NATIVE_AUTH_LIMITS,
  NATIVE_AUTH_PATTERN,
  areAllPasswordRulesPassed,
  isPasswordWithinByteLimit,
  zodName,
} from '@app/core';

const NAME_ERROR_KEY = 'native.invalidInput';
const NAME_SCHEMA = zodName({
  required: true,
  messages: {
    required: NAME_ERROR_KEY,
    min: NAME_ERROR_KEY,
    max: NAME_ERROR_KEY,
    pattern: NAME_ERROR_KEY,
    noLetter: NAME_ERROR_KEY,
  },
});

export function validNativeName(name: string): boolean {
  return NAME_SCHEMA.safeParse(name).success;
}

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
