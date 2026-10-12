import { MAX_CALLBACK_LENGTH } from '../constants';
import { parseUri } from '../sign-in/redirect';
import { constantTimeEqual } from '../storage/persistence';
import type { AuthRuntime } from '../runtime/runtime';

interface NativeEmailCallback {
  token: string;
  state: string;
}

export function parseNativeEmailCallback(
  address: string,
  runtime: AuthRuntime,
): NativeEmailCallback | undefined {
  const transaction = runtime.record?.transaction;
  const native = runtime.record?.nativeAttempt;
  if (!transaction || !native || address.length > MAX_CALLBACK_LENGTH) return undefined;
  const expected = parseUri(transaction.returnAddress);
  const actual = parseUri(address);
  if (!expected || !actual || actual.hasUserInfo || actual.hasFragment) return undefined;
  if (
    actual.scheme !== expected.scheme ||
    actual.host !== expected.host ||
    actual.port !== expected.port ||
    actual.path !== expected.path ||
    actual.hasAuthority !== expected.hasAuthority
  )
    return undefined;
  const values = new Map<string, string>();
  try {
    for (const pair of actual.query.split('&')) {
      const separator = pair.indexOf('=');
      const key = decodeURIComponent(
        (separator < 0 ? pair : pair.slice(0, separator)).replace(/\+/g, ' '),
      );
      const value = decodeURIComponent(
        (separator < 0 ? '' : pair.slice(separator + 1)).replace(/\+/g, ' '),
      );
      if (values.has(key)) return undefined;
      values.set(key, value);
    }
  } catch {
    return undefined;
  }
  if (values.size !== 3) return undefined;
  const attemptId = values.get('native_attempt_id');
  const token = values.get('native_email_token');
  const state = values.get('state');
  if (!attemptId || !token || !state || token.length > 4096) return undefined;
  if (!constantTimeEqual(attemptId, native.id) || !constantTimeEqual(state, transaction.state))
    return undefined;
  return { token, state };
}
