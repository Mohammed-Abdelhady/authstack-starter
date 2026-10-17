import { applicationCookieName } from '../utils/request/application-cookie-name';
import { WEB_CLIENT_ID } from './client-ids';
import type { BrowserApplicationId } from '../applications/types/browser-application';

export const CSRF_HEADER = 'x-csrf-token';

export const BROWSER_PROOF_COOKIE = 'bp';

export const BROWSER_PROOF_HOST_COOKIE = '__Host-bp';

export const BROWSER_PROOF_TTL_MS = 15 * 60 * 1000;

export const CSRF_TOKEN_MAX_LENGTH = 128;

export const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const FETCH_SITE = {
  CROSS_SITE: 'cross-site',
  SAME_SITE: 'same-site',
  SAME_ORIGIN: 'same-origin',
  NONE: 'none',
} as const;

export function browserProofCookieName(
  nodeEnv: string | undefined,
  clientId: BrowserApplicationId = WEB_CLIENT_ID,
): string {
  const name =
    nodeEnv === 'production' ? BROWSER_PROOF_HOST_COOKIE : BROWSER_PROOF_COOKIE;
  return applicationCookieName(name, clientId);
}
