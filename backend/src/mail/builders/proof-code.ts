import type { FreshProofMail } from '../../auth/contracts/types/fresh-proof';
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

/** Core proof of an action, independent of the optional email-code sign-in method. */
export function buildProofCodeMail(mail: FreshProofMail): MailContent {
  const locale = mail.recipient.locale;
  const { common, proofCode: copy } = MAIL_CATALOGUES[locale];
  const expiry = codeExpiry(locale, mail.expiresInMinutes);
  return {
    subject: copy.subject,
    html: htmlDocument(locale, copy.title, [
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
