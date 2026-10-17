import { HTTP_STATUS_OK } from '../constants';
import { malformedResponse, unwrapEnvelope } from '../envelope';
import { requireArray, requireObject } from '../shapes';
import { booleanValue, email } from '../native-auth/validation';
import type { TransportResponse } from '../transport';
import type { JsonFields } from '../types/json';
import type { BrowserEmailCodeResult, BrowserSignInUser } from '../types/browser-email-code';

function text(value: unknown, field: string, status: number): string {
  if (typeof value !== 'string') throw malformedResponse(status, `${field} is not text`);
  return value;
}

function signInUser(value: unknown, status: number): BrowserSignInUser {
  const user: JsonFields<BrowserSignInUser> = requireObject(value, 'data.user', status);
  return {
    id: text(user.id, 'user.id', status),
    email: email(user.email, 'user.email', status),
    name: text(user.name, 'user.name', status),
    role: text(user.role, 'user.role', status),
    authProvider: text(user.authProvider, 'user.authProvider', status),
    isVerified: booleanValue(user.isVerified, 'user.isVerified', status),
    permissions: requireArray(user.permissions, 'user.permissions', status).map((item) =>
      text(item, 'user.permissions item', status),
    ),
  };
}

export function unwrapBrowserEmailCodeRequest(response: TransportResponse): { email: string } {
  const data = requireObject(unwrapEnvelope<unknown>(response), 'data', response.status);
  return { email: email(data['email'], 'data.email', response.status) };
}

export function unwrapBrowserEmailCodeResult(response: TransportResponse): BrowserEmailCodeResult {
  const data = requireObject(unwrapEnvelope<unknown>(response), 'data', response.status);
  if (data['requiresTwoFactor'] === true && data['user'] === null) {
    return { requiresTwoFactor: true, user: null };
  }
  if (data['requiresTwoFactor'] === false) {
    return { requiresTwoFactor: false, user: signInUser(data['user'], response.status) };
  }
  throw malformedResponse(response.status, 'The sign-in state is inconsistent');
}

export function unwrapBrowserEmailCodeResultBody(body: unknown): BrowserEmailCodeResult {
  return unwrapBrowserEmailCodeResult({ status: HTTP_STATUS_OK, body });
}
