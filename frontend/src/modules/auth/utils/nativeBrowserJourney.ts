import { RESET_PASSWORD_PATH, REDIRECT_PARAM } from '../constants/authMethods'; // feature:email-password
import {
  NATIVE_BROWSER_FLOW,
  NATIVE_BROWSER_SELECTOR_QUERY,
} from '../constants/nativeBrowserSelectors';
import { isNativeAuthorizeContinuation } from '../constants/nativeAuthorize';
import type { NativeBrowserFlow } from '../types/nativeBrowserSelectors.types';
import { getRedirectPath } from './authHelpers';
import { authPagePath } from './signInRouting';
import { readNativeBrowserSelectors } from './nativeBrowserSelectors';

function nativeGuestFlow(
  redirect: string | null | undefined,
  flow: unknown,
): NativeBrowserFlow | undefined {
  const selected = readNativeBrowserSelectors({ flow })?.flow;
  if (selected === undefined || selected === NATIVE_BROWSER_FLOW.SIGN_IN) return undefined;
  return isNativeAuthorizeContinuation(getRedirectPath(redirect, '')) ? selected : undefined;
}

export function isNativeBrowserGuestJourney(
  redirect: string | null | undefined,
  flow: unknown,
  expectedFlow?: NativeBrowserFlow,
): boolean {
  const selected = nativeGuestFlow(redirect, flow);
  return selected !== undefined && (expectedFlow === undefined || selected === expectedFlow);
}

export function nativeBrowserJourneyPath(
  path: string,
  redirect: string | null | undefined,
  flow: unknown,
): string {
  const href = authPagePath(path, redirect);
  const selected = nativeGuestFlow(redirect, flow);
  return selected === undefined
    ? href
    : `${href}&${NATIVE_BROWSER_SELECTOR_QUERY.FLOW}=${selected}`;
}

// feature:email-password:start
export function passwordRecoveryPath(
  email: string,
  redirect?: string | null,
  flow?: unknown,
): string {
  const query = new URLSearchParams({ email });
  const continuation = getRedirectPath(redirect, '');
  if (continuation) query.set(REDIRECT_PARAM, continuation);
  const selected = nativeGuestFlow(redirect, flow);
  if (selected) query.set(NATIVE_BROWSER_SELECTOR_QUERY.FLOW, selected);
  return `${RESET_PASSWORD_PATH}?${query.toString()}`;
}
// feature:email-password:end
