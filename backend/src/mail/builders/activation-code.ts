import type { SupportedLocale } from '../../common/constants/locales';
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

export interface ActivationCodeMail {
  locale: SupportedLocale;
  code: string;
  expiresInMinutes: number;
}

/**
 * The sign-up code. The greeting is neutral: no name is stored before the
 * address is proved, so none can be shown.
 */
export function buildActivationCodeMail(mail: ActivationCodeMail): MailContent {
  const { common, activationCode: copy } = MAIL_CATALOGUES[mail.locale];
  const intro = `${copy.thanks} ${copy.instruction}`;
  const expiry = codeExpiry(mail.locale, mail.expiresInMinutes);
  return {
    subject: copy.subject,
    html: htmlDocument(mail.locale, copy.title, [
      heading(copy.heading),
      paragraph(common.greeting),
      paragraph(intro),
      codeBlock(mail.code, MAIL_COLOR.PRIMARY),
      paragraph(expiry),
      paragraph(copy.ignore),
      signOffHtml(common),
    ]),
    text: textBody([
      common.greeting,
      intro,
      mail.code,
      expiry,
      copy.ignore,
      signOffText(common),
    ]),
  };
}
