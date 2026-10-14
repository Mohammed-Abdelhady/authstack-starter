import type { SupportedLocale } from '../../common/constants/locales';
import { escapeHtml } from '../../common/utils/escape-html';
import { formatMessage } from '../catalog/format-message';
import { MAIL_COLOR } from '../constants/mail-colors';
import type { MailBlock } from '../types/mail-block.types';

/** Every block escaped whole. A code and a link stay left to right. */
function blockHtml(block: MailBlock): string[] {
  switch (block.kind) {
    case 'heading':
      return [
        `<h2 style="color: ${MAIL_COLOR.TEXT};">${escapeHtml(block.text)}</h2>`,
      ];
    case 'paragraph':
      return [`<p>${escapeHtml(formatMessage(block.message, block.args))}</p>`];
    case 'code':
      return [
        `<div style="background-color: ${MAIL_COLOR.PANEL}; padding: 20px; text-align: center; border-radius: 5px; margin: 20px 0;"><span dir="ltr" style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: ${block.color};">${escapeHtml(block.code)}</span></div>`,
      ];
    case 'button':
      return [
        `<div style="margin: 20px 0;"><a href="${escapeHtml(block.href)}" style="background-color: ${MAIL_COLOR.PRIMARY}; color: ${MAIL_COLOR.ON_PRIMARY}; padding: 12px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">${escapeHtml(block.label)}</a></div>`,
      ];
    case 'linkFallback':
      return [
        `<p>${escapeHtml(block.note)}</p>`,
        `<p dir="ltr" style="word-break: break-all; color: ${MAIL_COLOR.MUTED};">${escapeHtml(block.href)}</p>`,
      ];
    case 'signOff':
      return [
        `<p>${escapeHtml(block.signOff)}<br>${escapeHtml(block.team)}</p>`,
      ];
  }
}

/**
 * The right-to-left document. `lang` and `dir` sit on the root and again on
 * the content block, as attributes rather than CSS, so a client that strips
 * the root or ignores styles still lays the mail out right to left.
 */
export function rtlDocument(
  locale: SupportedLocale,
  title: string,
  blocks: MailBlock[],
): string {
  return [
    '<!DOCTYPE html>',
    `<html lang="${locale}" dir="rtl">`,
    '  <head>',
    '    <meta charset="utf-8">',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `    <title>${escapeHtml(title)}</title>`,
    '  </head>',
    `  <body style="font-family: Arial, Tahoma, sans-serif; line-height: 1.6; color: ${MAIL_COLOR.TEXT};">`,
    `    <div lang="${locale}" dir="rtl" style="max-width: 600px; margin: 0 auto; padding: 20px;">`,
    ...blocks.flatMap(blockHtml).map((line) => `      ${line}`),
    '    </div>',
    '  </body>',
    '</html>',
  ].join('\n');
}
