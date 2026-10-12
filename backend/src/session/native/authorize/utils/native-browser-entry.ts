import { HttpStatus } from '@nestjs/common';
import {
  NATIVE_AUTHORIZE_CLIENT_PATH,
  NATIVE_TRANSACTION_QUERY_KEY,
} from '../../../../common/constants/client-paths';
import { OAUTH_ERROR, oauthFailure } from '../../oauth/native-oauth.types';
import { negotiateNativeAuthorizeLocale } from '../native-locale.util';
import { NATIVE_BROWSER_SELECTOR_QUERY } from '../constants/native-browser-selectors';
import type {
  NativeBrowserEntryDependencies,
  NativeBrowserEntryResult,
} from '../types/native-browser-selectors';
import { readNativeBrowserSelectors } from './native-browser-selectors';

export async function beginNativeBrowserAuthorization(
  query: unknown,
  acceptLanguage: string | string[] | undefined,
  dependencies: NativeBrowserEntryDependencies,
): Promise<NativeBrowserEntryResult> {
  const selectors = readNativeBrowserSelectors(query, dependencies.providers);
  if (!selectors)
    return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_REQUEST);
  const begun = await dependencies.authorize.begin(query);
  if (!begun.ok) return begun;
  const locale =
    selectors.locale ?? negotiateNativeAuthorizeLocale(acceptLanguage);
  const target = new URL(
    `/${locale}${NATIVE_AUTHORIZE_CLIENT_PATH}`,
    dependencies.clientUrl,
  );
  target.searchParams.set(NATIVE_TRANSACTION_QUERY_KEY, begun.transactionId);
  if (selectors.providerId !== undefined) {
    target.searchParams.set(
      NATIVE_BROWSER_SELECTOR_QUERY.PROVIDER_ID,
      selectors.providerId,
    );
  }
  if (selectors.flow !== undefined) {
    target.searchParams.set(NATIVE_BROWSER_SELECTOR_QUERY.FLOW, selectors.flow);
  }
  return { ok: true, location: target.toString() };
}
