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

export interface PasswordResetCodeMail {
  locale: SupportedLocale;
  code: string;
  expiresInMinutes: number;
  /** The account holder's name, escaped wherever it reaches the HTML. */
  name: string;
}

export function buildPasswordResetCodeMail(
  mail: PasswordResetCodeMail,
): MailContent {
  const { common, passwordResetCode: copy } = MAIL_CATALOGUES[mail.locale];
  const names = { name: mail.name };
  const greeting = formatMessage(common.greetingNamed, names);
  const expiry = codeExpiry(mail.locale, mail.expiresInMinutes);
  return {
    subject: copy.subject,
    html: htmlDocument(mail.locale, copy.title, [
      heading(copy.heading),
      paragraph(common.greetingNamed, names),
      paragraph(copy.instruction),
      codeBlock(mail.code, MAIL_COLOR.DANGER),
      paragraph(expiry),
      paragraph(copy.ignore),
      signOffHtml(common),
    ]),
    text: textBody([
      greeting,
      copy.instruction,
      mail.code,
      expiry,
      copy.ignore,
      signOffText(common),
    ]),
  };
}
