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
  linkButton,
  linkFallback,
  paragraph,
  signOffHtml,
  signOffText,
  textBody,
} from './mail-layout';

export interface EmailChangeCodeMail {
  locale: SupportedLocale;
  code: string;
  expiresInMinutes: number;
  /** The confirmation page. It carries no address and no code. */
  confirmUrl: string;
}

/**
 * The code that confirms a new address an admin moved an account to. The copy
 * names the change, so it is not mistaken for a sign-up code.
 */
export function buildEmailChangeCodeMail(
  mail: EmailChangeCodeMail,
): MailContent {
  const { common, emailChangeCode: copy } = MAIL_CATALOGUES[mail.locale];
  const expiry = codeExpiry(mail.locale, mail.expiresInMinutes);
  return {
    subject: copy.subject,
    html: htmlDocument(mail.locale, copy.title, [
      heading(copy.heading),
      paragraph(common.greeting),
      paragraph(copy.instruction),
      codeBlock(mail.code, MAIL_COLOR.PRIMARY),
      linkButton(mail.confirmUrl, copy.button),
      linkFallback(common, mail.confirmUrl),
      paragraph(expiry),
      paragraph(copy.unexpected),
      signOffHtml(common),
    ]),
    text: textBody([
      common.greeting,
      copy.instruction,
      mail.confirmUrl,
      formatMessage(copy.codeLine, { code: mail.code }),
      expiry,
      copy.unexpected,
      signOffText(common),
    ]),
  };
}
