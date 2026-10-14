import {
  negotiateLocale,
  SupportedLocale,
} from '../../../common/constants/locales';

export function negotiateNativeAuthorizeLocale(
  acceptLanguage: string | string[] | undefined,
): SupportedLocale {
  return negotiateLocale(acceptLanguage);
}
