import { AR } from './ar'; // feature:locale-ar
import { EN, type MessageKey } from './en';

export type { MessageKey } from './en';

export const LOCALE = {
  EN: 'en',
  AR: 'ar', // feature:locale-ar
} as const;
export type Locale = (typeof LOCALE)[keyof typeof LOCALE];
export type Direction = 'ltr' | 'rtl';

export const DIRECTION: Record<Locale, Direction> = {
  en: 'ltr',
  ar: 'rtl', // feature:locale-ar
};

export const MESSAGES: Record<Locale, Record<MessageKey, string>> = {
  en: EN,
  ar: AR, // feature:locale-ar
};

export type MessageArguments = Readonly<Record<string, string>>;
export type Translate = (key: MessageKey, values?: MessageArguments) => string;

const PLACEHOLDER = /\{(\w+)\}/g;

/** Names of the `{placeholders}` a message takes, sorted. */
export function placeholdersOf(message: string): string[] {
  return [...new Set([...message.matchAll(PLACEHOLDER)].map(([, name]) => name ?? ''))].sort();
}

/** The language of a locale tag, with or without a region, and the locale it reads. */
const TAG_LOCALES: readonly (readonly [RegExp, Locale])[] = [
  [/^ar(?:[-_]|$)/i, LOCALE.AR], // feature:locale-ar
];

/** A tag of a language the screens ship reads that language. Every other tag reads English. */
export function resolveLocale(tag: string | undefined): Locale {
  return TAG_LOCALES.find(([pattern]) => pattern.test(tag ?? ''))?.[1] ?? LOCALE.EN;
}

/** A placeholder with no value stays visible, so a missing argument shows up in review. */
export function translate(locale: Locale, key: MessageKey, values: MessageArguments = {}): string {
  return MESSAGES[locale][key].replace(PLACEHOLDER, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? (values[name] ?? placeholder) : placeholder,
  );
}

export function createTranslate(locale: Locale): Translate {
  return (key, values) => translate(locale, key, values);
}
