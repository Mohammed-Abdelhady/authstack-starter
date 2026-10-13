import { isAppLocale } from '@/i18n/load-messages';
import {
  NATIVE_BROWSER_FLOW,
  NATIVE_BROWSER_AVAILABLE_FLOWS,
  NATIVE_BROWSER_PROVIDER_PATTERNS,
  NATIVE_BROWSER_SELECTOR_QUERY,
} from '../constants/nativeBrowserSelectors';
import type {
  NativeBrowserFlow,
  NativeBrowserSelectors,
} from '../types/nativeBrowserSelectors.types';

export function readNativeBrowserSelectors(query: unknown): NativeBrowserSelectors | null {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return null;
  const values = query as Record<string, unknown>;
  const providerId = values[NATIVE_BROWSER_SELECTOR_QUERY.PROVIDER_ID];
  const flowValue = values[NATIVE_BROWSER_SELECTOR_QUERY.FLOW];
  const localeValue = values[NATIVE_BROWSER_SELECTOR_QUERY.LOCALE];
  const flow = Object.values(NATIVE_BROWSER_FLOW).find(
    (candidate) => candidate === flowValue && NATIVE_BROWSER_AVAILABLE_FLOWS.includes(candidate),
  );
  const locale =
    typeof localeValue === 'string' && isAppLocale(localeValue) ? localeValue : undefined;
  if (
    Object.keys(values).some((key) =>
      Object.values(NATIVE_BROWSER_SELECTOR_QUERY).some((selector) =>
        key.startsWith(`${selector}[`),
      ),
    )
  )
    return null;
  if (flowValue !== undefined && flow === undefined) return null;
  if (localeValue !== undefined && locale === undefined) return null;
  if (providerId !== undefined) {
    if (
      typeof providerId !== 'string' ||
      !NATIVE_BROWSER_PROVIDER_PATTERNS.some((pattern) => pattern.test(providerId))
    )
      return null;
    if (flow !== undefined && flow !== NATIVE_BROWSER_FLOW.SIGN_IN) return null;
  }
  return {
    ...(typeof providerId === 'string' ? { providerId } : {}),
    ...(flow === undefined ? {} : { flow }),
    ...(locale === undefined ? {} : { locale }),
  };
}

export function readNativeBrowserGuestFlow(
  query: Pick<URLSearchParams, 'getAll'>,
): NativeBrowserFlow | undefined {
  const values = query.getAll(NATIVE_BROWSER_SELECTOR_QUERY.FLOW);
  return values.length === 1 ? readNativeBrowserSelectors({ flow: values[0] })?.flow : undefined;
}
