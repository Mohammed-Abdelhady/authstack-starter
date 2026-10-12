import { SUPPORTED_LOCALES } from '../../../../common/constants/locales';
import {
  NATIVE_BROWSER_FLOW,
  NATIVE_BROWSER_SELECTOR_QUERY,
} from '../constants/native-browser-selectors';
import type {
  NativeBrowserMethodLookup,
  NativeBrowserSelectors,
} from '../types/native-browser-selectors';

export function readNativeBrowserSelectors(
  query: unknown,
  providers: NativeBrowserMethodLookup,
): NativeBrowserSelectors | null {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return null;
  const values = query as Record<string, unknown>;
  if (
    Object.keys(values).some((key) =>
      Object.values(NATIVE_BROWSER_SELECTOR_QUERY).some((selector) =>
        key.startsWith(`${selector}[`),
      ),
    )
  )
    return null;
  const providerId = values[NATIVE_BROWSER_SELECTOR_QUERY.PROVIDER_ID];
  const flowValue = values[NATIVE_BROWSER_SELECTOR_QUERY.FLOW];
  const localeValue = values[NATIVE_BROWSER_SELECTOR_QUERY.LOCALE];
  const flow = Object.values(NATIVE_BROWSER_FLOW).find(
    (candidate) => candidate === flowValue,
  );
  const locale = SUPPORTED_LOCALES.find(
    (candidate) => candidate === localeValue,
  );

  if (flowValue !== undefined && flow === undefined) return null;
  if (localeValue !== undefined && locale === undefined) return null;
  if (
    flow !== undefined &&
    flow !== NATIVE_BROWSER_FLOW.SIGN_IN &&
    !providers.isPasswordEnabled()
  )
    return null;
  if (providerId !== undefined) {
    if (typeof providerId !== 'string' || providerId.length === 0) return null;
    if (flow !== undefined && flow !== NATIVE_BROWSER_FLOW.SIGN_IN) return null;
    if (!providers.isEnabled(providerId)) return null;
  }
  return {
    ...(typeof providerId === 'string' ? { providerId } : {}),
    ...(flow === undefined ? {} : { flow }),
    ...(locale === undefined ? {} : { locale }),
  };
}
