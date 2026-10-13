import {
  NATIVE_EMAIL_MAX_LENGTH,
  NATIVE_EMAIL_PATTERN,
} from '../constants/native-email';

export function isNativeEmail(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= NATIVE_EMAIL_MAX_LENGTH &&
    NATIVE_EMAIL_PATTERN.test(value)
  );
}
