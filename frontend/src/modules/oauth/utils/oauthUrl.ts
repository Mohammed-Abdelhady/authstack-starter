import { store } from '@/store/store';
import { oauthApi } from '../api/oauthApi';
import { API_BASE_URL } from '@/constants/api';
import { getRedirectPath } from '@/modules/auth/utils';
import { OAUTH_ROUTE_BASE } from '../constants';

/** Legacy navigation used by native browser continuation always starts web. */
export function buildOAuthStartUrl(
  providerId: string,
  redirect: string,
  intent: 'login' | 'link' = 'login',
): string {
  const url = new URL(`${OAUTH_ROUTE_BASE}/${encodeURIComponent(providerId)}/start`, API_BASE_URL);
  url.searchParams.set('redirect', redirect);
  if (intent === 'link') {
    url.searchParams.set('intent', 'link');
  }
  return url.toString();
}

/**
 * Where a sign-in started on the current page should land.
 * Reads the `redirect` query parameter and rejects anything unsafe.
 */
export function currentRedirectPath(): string {
  return getRedirectPath(new URLSearchParams(window.location.search).get('redirect'));
}

/**
 * Sends the browser to the provider through the backend start route.
 */
export async function startOAuthFlow(
  providerId: string,
  redirect: string,
  intent: 'login' | 'link' = 'login',
): Promise<void> {
  const request = store.dispatch(
    oauthApi.endpoints.startOAuth.initiate({ providerId, redirect, intent }),
  );
  try {
    window.location.assign(await request.unwrap());
  } finally {
    request.reset();
  }
}
