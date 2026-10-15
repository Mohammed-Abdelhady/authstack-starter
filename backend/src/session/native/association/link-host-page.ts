import { SUPPORTED_LOCALES } from '../../../common/constants/locales';
import type { SupportedLocale } from '../../../common/constants/locales';
import { escapeHtml } from '../../../common/utils/escape-html';
import {
  LOCALE_DIRECTION,
  MAIL_CATALOGUES,
} from '../../../mail/catalog/mail-catalogue';

/** The renderer receives only a fixed catalogue language, never request text. */
function page(locale: SupportedLocale): string {
  const messages = MAIL_CATALOGUES[locale].common;
  return [
    '<!doctype html>',
    `<html lang="${locale}" dir="${LOCALE_DIRECTION[locale]}">`,
    '<head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex,nofollow">',
    `<title>${escapeHtml(messages.nativeLinkTitle)}</title></head>`,
    `<body><main><h1>${escapeHtml(messages.nativeLinkTitle)}</h1>`,
    `<p>${escapeHtml(messages.nativeLinkMessage)}</p></main></body></html>`,
  ].join('');
}

export function linkHostPages(): ReadonlyMap<SupportedLocale, string> {
  return new Map(SUPPORTED_LOCALES.map((locale) => [locale, page(locale)]));
}
