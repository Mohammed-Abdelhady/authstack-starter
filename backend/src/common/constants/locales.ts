export const SUPPORTED_LOCALES = [
  'en',
  'ar', // feature:locale-ar
] as const;
export const DEFAULT_LOCALE = 'en';

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Longest language tag a request body may carry, from RFC 5646's limit. */
export const LANGUAGE_TAG_MAX_LENGTH = 35;

interface LanguagePreference {
  language: string;
  quality: number;
  order: number;
}

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return SUPPORTED_LOCALES.some((locale) => locale === value);
}

/**
 * The language stored on an account. A record written before accounts had
 * one, or holding a language this build no longer carries, reads as the
 * default.
 */
export function storedLocale(value: unknown): SupportedLocale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

/** The supported locale a language tag names, by its primary subtag. */
function localeOfTag(tag: string): SupportedLocale | undefined {
  const primary = tag.trim().split('-')[0].toLowerCase();
  return SUPPORTED_LOCALES.find((locale) => locale === primary);
}

/** RFC 9110's qvalue: 0 to 1 with at most three decimals. */
const QVALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;
const QUALITY_PARAMETER = 'q';
/** The quality of a range that gives none. */
const FULL_QUALITY = 1;

/** A range's quality, or undefined when its weight is malformed. */
function qualityOf(parameters: string[]): number | undefined {
  const weight = parameters
    .map((parameter) => parameter.split('='))
    .find(([name]) => name.trim().toLowerCase() === QUALITY_PARAMETER);
  if (!weight) return FULL_QUALITY;
  const value = weight.length === 2 ? weight[1].trim() : '';
  return QVALUE.test(value) ? Number.parseFloat(value) : undefined;
}

/** One range of the header, or undefined when its weight is malformed. */
function parsePreference(
  value: string,
  order: number,
): LanguagePreference | undefined {
  const [rawLanguage, ...parameters] = value.trim().split(';');
  const quality = qualityOf(parameters);
  if (quality === undefined) return undefined;
  return { language: rawLanguage.trim(), quality, order };
}

/** The range that stands for every language the header does not name. */
const WILDCARD = '*';

interface Acceptance {
  quality: number;
  order: number;
}

/**
 * How acceptable one supported locale is: the first of the ranges that name
 * it at their best quality, else `*`, else not at all. Position only breaks a
 * tie in quality, so it comes from that same range.
 */
function acceptanceOf(
  locale: SupportedLocale,
  preferences: LanguagePreference[],
): Acceptance | undefined {
  const named = preferences.filter(
    (preference) => localeOfTag(preference.language) === locale,
  );
  if (named.length === 0) {
    return preferences.find(({ language }) => language === WILDCARD);
  }
  return named.reduce((best, preference) =>
    preference.quality > best.quality ? preference : best,
  );
}

/**
 * The best supported locale an `Accept-Language` header asks for, as RFC 9110
 * section 12.5.4 reads it: a quality of 0 excludes a language, `*` covers
 * every supported language the header does not name, and equal qualities keep
 * header order. When nothing is acceptable the answer is still the default,
 * because a request is never refused for its language.
 */
export function negotiateLocale(
  acceptLanguage: string | string[] | undefined,
): SupportedLocale {
  const header = Array.isArray(acceptLanguage)
    ? acceptLanguage.join(',')
    : (acceptLanguage ?? '');
  const preferences = header
    .split(',')
    .map(parsePreference)
    .filter((preference) => preference !== undefined);
  let best: (Acceptance & { locale: SupportedLocale }) | undefined;
  for (const locale of SUPPORTED_LOCALES) {
    const acceptance = acceptanceOf(locale, preferences);
    if (!acceptance || acceptance.quality <= 0) continue;
    const better =
      !best ||
      acceptance.quality > best.quality ||
      (acceptance.quality === best.quality && acceptance.order < best.order);
    if (better) best = { ...acceptance, locale };
  }
  return best?.locale ?? DEFAULT_LOCALE;
}

/**
 * The language a body names for someone else, such as the account an admin
 * creates: its `locale` when supported, else the default. The sender's own
 * `Accept-Language` says nothing about that person.
 */
export function chosenLocale(bodyLocale: unknown): SupportedLocale {
  return typeof bodyLocale === 'string'
    ? (localeOfTag(bodyLocale) ?? DEFAULT_LOCALE)
    : DEFAULT_LOCALE;
}

/**
 * The language of a request: the body's `locale` when it names a supported
 * one, then `Accept-Language`, then the default. A body language this build
 * does not carry falls through rather than failing, so a phone set to any
 * language can still sign up.
 */
export function requestLocale(
  bodyLocale: unknown,
  acceptLanguage: string | string[] | undefined,
): SupportedLocale {
  const fromBody =
    typeof bodyLocale === 'string' ? localeOfTag(bodyLocale) : undefined;
  return fromBody ?? negotiateLocale(acceptLanguage);
}
