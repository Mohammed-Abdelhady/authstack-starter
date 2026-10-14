import type { SupportedLocale } from '../../common/constants/locales';
import type { CommonMessages } from '../catalog/en/common';
import type { MessageArguments } from '../catalog/format-message';
import { formatCount, formatMessage } from '../catalog/format-message';
import { LOCALE_DIRECTION, MAIL_CATALOGUES } from '../catalog/mail-catalogue';
import type { MailBlock } from '../types/mail-block.types';
import type { MailContent } from '../types/mail-catalogue.types';
import { ltrBareDocument, ltrDocument } from './ltr-layout';
import { rtlDocument } from './rtl-layout';

function isRightToLeft(locale: SupportedLocale): boolean {
  return LOCALE_DIRECTION[locale] === 'rtl';
}

/** The whole HTML document, in the layout of the language's direction. */
export function htmlDocument(
  locale: SupportedLocale,
  title: string,
  blocks: MailBlock[],
): string {
  return isRightToLeft(locale)
    ? rtlDocument(locale, title, blocks)
    : ltrDocument(title, blocks);
}

/**
 * A short document with no head or heading. Right to left still gets the full
 * document, because only it declares the direction.
 */
export function bareHtmlDocument(
  locale: SupportedLocale,
  title: string,
  blocks: MailBlock[],
): string {
  return isRightToLeft(locale)
    ? rtlDocument(locale, title, blocks)
    : ltrBareDocument(blocks);
}

export function heading(text: string): MailBlock {
  return { kind: 'heading', text };
}

/** `args` are values from outside the catalogue, such as a name. */
export function paragraph(
  message: string,
  args: MessageArguments = {},
): MailBlock {
  return { kind: 'paragraph', message, args };
}

export function codeBlock(code: string, color: string): MailBlock {
  return { kind: 'code', code, color };
}

export function linkButton(href: string, label: string): MailBlock {
  return { kind: 'button', href, label };
}

/** The address written out under its button, for a client that hides the button. */
export function linkFallback(common: CommonMessages, href: string): MailBlock {
  return { kind: 'linkFallback', note: common.buttonFallback, href };
}

export function signOffHtml(common: CommonMessages): MailBlock {
  return { kind: 'signOff', signOff: common.signOff, team: common.team };
}

export function signOffText(common: CommonMessages): string {
  return `${common.signOff}\n${common.team}`;
}

/** Plain text parts, one blank line apart. */
export function textBody(parts: string[]): string {
  return parts.join('\n\n');
}

/**
 * A mail with nothing to click: plain text only. A right-to-left language
 * also gets an HTML part, because only a document root can declare the
 * direction.
 */
export function plainTextMail(
  locale: SupportedLocale,
  mail: { subject: string; text: string; blocks: MailBlock[] },
): MailContent {
  const { subject, text, blocks } = mail;
  if (!isRightToLeft(locale)) {
    return { subject, text };
  }
  return { subject, html: rtlDocument(locale, subject, blocks), text };
}

/** "15 minutes", in the recipient's language and its plural rules. */
export function minutesPhrase(
  locale: SupportedLocale,
  minutes: number,
): string {
  return formatCount(locale, MAIL_CATALOGUES[locale].common.minutes, minutes);
}

/** The lifetime sentence every code mail ends with. */
export function codeExpiry(locale: SupportedLocale, minutes: number): string {
  return formatMessage(MAIL_CATALOGUES[locale].common.codeExpiry, {
    minutes: minutesPhrase(locale, minutes),
  });
}
