import type { AppLocale } from '@/i18n/load-messages';
import type { NATIVE_BROWSER_FLOW } from '../constants/nativeBrowserSelectors';

export type NativeBrowserFlow = (typeof NATIVE_BROWSER_FLOW)[keyof typeof NATIVE_BROWSER_FLOW];

export interface NativeBrowserSelectors {
  providerId?: string;
  flow?: NativeBrowserFlow;
  locale?: AppLocale;
}

export type NativeBrowserSignInTarget =
  { kind: 'page'; href: string } | { kind: 'provider'; href: string };
