import { AR } from './ar'; // feature:locale-ar
import { EN, type MessageKey } from './en';

export type { MessageKey } from './en';

/** The screens package decides the locale. This catalogue only has to cover the same ones. */
export const LOCALES = [
  'en',
  'ar', // feature:locale-ar
] as const;
export type Locale = (typeof LOCALES)[number];
export type Direction = 'ltr' | 'rtl';

export const DIRECTION: Record<Locale, Direction> = {
  en: 'ltr',
  ar: 'rtl', // feature:locale-ar
};

export const MESSAGES: Record<Locale, Record<MessageKey, string>> = {
  en: EN,
  ar: AR, // feature:locale-ar
};

export const VALUE_PLACEHOLDER = '{value}';
export const DETAIL_PLACEHOLDER = '{detail}';

export function translate(
  locale: Locale,
  key: MessageKey,
  value?: string,
  detail?: string,
): string {
  const template = MESSAGES[locale][key];
  const withValue =
    value === undefined ? template : template.replace(VALUE_PLACEHOLDER, () => value);
  return detail === undefined ? withValue : withValue.replace(DETAIL_PLACEHOLDER, () => detail);
}
