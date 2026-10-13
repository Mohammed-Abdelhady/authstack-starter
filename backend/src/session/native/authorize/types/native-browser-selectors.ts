import type { SupportedLocale } from '../../../../common/constants/locales';
import type { NativeAuthorizeService } from '../native-authorize.service';
import type { NATIVE_BROWSER_FLOW } from '../constants/native-browser-selectors';
import type { OauthFailure } from '../../oauth/native-oauth.types';

export type NativeBrowserFlow =
  (typeof NATIVE_BROWSER_FLOW)[keyof typeof NATIVE_BROWSER_FLOW];

export interface NativeBrowserSelectors {
  providerId?: string;
  flow?: NativeBrowserFlow;
  locale?: SupportedLocale;
}

export interface NativeBrowserProviderLookup {
  isEnabled(providerId: string): boolean;
}

export interface NativeBrowserMethodLookup extends NativeBrowserProviderLookup {
  isPasswordEnabled(): boolean;
}

export interface NativeBrowserEntryDependencies {
  authorize: Pick<NativeAuthorizeService, 'begin'>;
  providers: NativeBrowserMethodLookup;
  clientUrl: string;
}

export type NativeBrowserEntryResult =
  { ok: true; location: string } | OauthFailure;
