import { ErrorCode } from '@app/core/errors';
import { AUTH_PATHS } from '../areas/auth';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const CSRF_HEADER = 'x-csrf-token';
export const HTTP_STATUS_NO_CONTENT = 204;
export const HTTP_STATUS_UNAUTHORIZED = 401;
export const SERVER_ERROR_STATUS_MIN = 500;
export const CSRF_ENDPOINT = '/api/auth/csrf';
export const BROWSER_PROOF_ENDPOINT = '/api/auth/browser-proof';
export const IDENTITY_ENDPOINT = AUTH_PATHS.identity;
export const LOGOUT_ENDPOINT = AUTH_PATHS.logout;
export const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const CSRF_FAILURE_CODES: ReadonlySet<string> = new Set([
  ErrorCode.CSRF_INVALID,
  ErrorCode.CSRF_REQUIRED,
]);

export function methodNeedsBrowserProof(method: string | undefined): boolean {
  return UNSAFE_METHODS.has((method ?? 'GET').toUpperCase());
}
