import { buildOAuthStartUrl } from '@/modules/oauth'; // feature:oauth-core
import { LOGIN_PATH } from '../constants/authMethods';
import { FORGOT_PASSWORD_PATH, REGISTER_PATH } from '../constants/authMethods'; // feature:email-password
import { nativeAuthorizeContinuation } from '../constants/nativeAuthorize';
import { NATIVE_BROWSER_FLOW } from '../constants/nativeBrowserSelectors';
import type {
  NativeBrowserSelectors,
  NativeBrowserSignInTarget,
  NativeBrowserFlow,
} from '../types/nativeBrowserSelectors.types';
import { nativeBrowserJourneyPath } from './nativeBrowserJourney';

const FLOW_PATHS: ReadonlyMap<NativeBrowserFlow, string> = new Map([
  [NATIVE_BROWSER_FLOW.SIGN_IN, LOGIN_PATH],
  [NATIVE_BROWSER_FLOW.REGISTRATION, REGISTER_PATH], // feature:email-password
  [NATIVE_BROWSER_FLOW.RECOVERY, FORGOT_PASSWORD_PATH], // feature:email-password
]);

export function nativeBrowserSignInTarget(
  transaction: string,
  selectors?: NativeBrowserSelectors,
): NativeBrowserSignInTarget {
  const continuation = nativeAuthorizeContinuation(transaction);
  // feature:oauth-core:start
  if (selectors?.providerId !== undefined) {
    return { kind: 'provider', href: buildOAuthStartUrl(selectors.providerId, continuation) };
  }
  // feature:oauth-core:end
  const path = FLOW_PATHS.get(selectors?.flow ?? NATIVE_BROWSER_FLOW.SIGN_IN);
  if (path === undefined) throw new TypeError('Native browser journey is unavailable');
  return { kind: 'page', href: nativeBrowserJourneyPath(path, continuation, selectors?.flow) };
}

export function hasExplicitNativeBrowserSelection(selectors?: NativeBrowserSelectors): boolean {
  return (
    selectors?.providerId !== undefined ||
    (selectors?.flow !== undefined && selectors.flow !== NATIVE_BROWSER_FLOW.SIGN_IN)
  );
}
