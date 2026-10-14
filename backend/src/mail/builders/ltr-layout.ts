import { escapeHtml } from '../../common/utils/escape-html';
import { formatMessage } from '../catalog/format-message';
import type { MessageArguments } from '../catalog/format-message';
import { MAIL_COLOR } from '../constants/mail-colors';
import type { MailBlock } from '../types/mail-block.types';

/**
 * Left-to-right mail keeps the markup English mail has always had, byte for
 * byte, so a project made before the catalogue sends the same HTML. Copy from
 * the catalogue goes in as written; codes, names and links are escaped.
 */

/** The template's own indentation: the document sits six spaces in. */
const DOCUMENT_INDENT = '      ';
const BLOCK_INDENT = '      ';
const CHILD_INDENT = '  ';
/** The template literal closed on a line of its own, four spaces in. */
const DOCUMENT_TAIL = '\n    ';

function escapedArguments(args: MessageArguments): MessageArguments {
  return Object.fromEntries(
    Object.entries(args).map(([name, value]) => [
      name,
      escapeHtml(String(value)),
    ]),
  );
}

function blockLines(block: MailBlock): string[] {
  switch (block.kind) {
    case 'heading':
      return [`<h2 style="color: ${MAIL_COLOR.TEXT};">${block.text}</h2>`];
    case 'paragraph':
      return [
        `<p>${formatMessage(block.message, escapedArguments(block.args))}</p>`,
      ];
    case 'code':
      return [
        `<div style="background-color: ${MAIL_COLOR.PANEL}; padding: 20px; text-align: center; border-radius: 5px; margin: 20px 0;">`,
        `${CHILD_INDENT}<span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: ${block.color};">${escapeHtml(block.code)}</span>`,
        '</div>',
      ];
    case 'button':
      return [
        '<div style="margin: 20px 0;">',
        `${CHILD_INDENT}<a href="${escapeHtml(block.href)}" style="background-color: ${MAIL_COLOR.PRIMARY}; color: ${MAIL_COLOR.ON_PRIMARY}; padding: 12px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">${block.label}</a>`,
        '</div>',
      ];
    case 'linkFallback':
      return [
        `<p>${block.note}</p>`,
        `<p style="word-break: break-all; color: ${MAIL_COLOR.MUTED};">${escapeHtml(block.href)}</p>`,
      ];
    case 'signOff':
      return [`<p>${block.signOff}<br>${block.team}</p>`];
  }
}

/** The full document, with a head, laid out as English mail always was. */
export function ltrDocument(title: string, blocks: MailBlock[]): string {
  const lines = [
    '<!DOCTYPE html>',
    '<html>',
    '  <head>',
    '    <meta charset="utf-8">',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `    <title>${title}</title>`,
    '  </head>',
    `  <body style="font-family: Arial, sans-serif; line-height: 1.6; color: ${MAIL_COLOR.TEXT};">`,
    '    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">',
    ...blocks.flatMap(blockLines).map((line) => `${BLOCK_INDENT}${line}`),
    '    </div>',
    '  </body>',
    '</html>',
  ];
  const body = lines.map((line) => `${DOCUMENT_INDENT}${line}`).join('\n');
  return `\n${body}${DOCUMENT_TAIL}`;
}

/** A one-line document with no head, as the email change notice always was. */
export function ltrBareDocument(blocks: MailBlock[]): string {
  const body = blocks.flatMap(blockLines).join('');
  return `<!DOCTYPE html><html><body>${body}</body></html>`;
}
