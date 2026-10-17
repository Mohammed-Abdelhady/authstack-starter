import type { SupportedLocale } from '../../common/constants/locales';
import { formatMessage } from '../catalog/format-message';
import { MAIL_CATALOGUES } from '../catalog/mail-catalogue';
import { MAIL_COLOR } from '../constants/mail-colors';
import type { MailContent } from '../types/mail-catalogue.types';
import {
  codeBlock,
  codeExpiry,
  heading,
  htmlDocument,
  paragraph,
  signOffHtml,
  signOffText,
  textBody,
} from './mail-layout';

export interface OwnEmailChangeCodeMail {
  locale: SupportedLocale;
  code: string;
  expiresInMinutes: number;
}

/**
 * The code that confirms an address the account holder asked for. It names no
 * one and carries no link: the person types it where they asked.
 */
export function buildOwnEmailChangeCodeMail(
  mail: OwnEmailChangeCodeMail,
): MailContent {
  const { common, ownEmailChangeCode: copy } = MAIL_CATALOGUES[mail.locale];
  const expiry = codeExpiry(mail.locale, mail.expiresInMinutes);
  return {
    subject: copy.subject,
    html: htmlDocument(mail.locale, copy.title, [
      heading(copy.heading),
      paragraph(common.greeting),
      paragraph(copy.instruction),
      codeBlock(mail.code, MAIL_COLOR.PRIMARY),
      paragraph(expiry),
      paragraph(copy.unexpected),
      signOffHtml(common),
    ]),
    text: textBody([
      common.greeting,
      copy.instruction,
      formatMessage(copy.codeLine, { code: mail.code }),
      expiry,
      copy.unexpected,
      signOffText(common),
    ]),
  };
}
