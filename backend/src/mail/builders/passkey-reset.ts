import type { SupportedLocale } from '../../common/constants/locales';
import { formatCount, formatMessage } from '../catalog/format-message';
import { MAIL_CATALOGUES } from '../catalog/mail-catalogue';
import type { MailContent } from '../types/mail-catalogue.types';
import {
  heading,
  htmlDocument,
  linkButton,
  linkFallback,
  paragraph,
  signOffHtml,
  signOffText,
  textBody,
} from './mail-layout';

interface PasskeyResetMail {
  locale: SupportedLocale;
  link: string;
  expiresInDays: number;
}

export function buildPasskeyResetMail(mail: PasskeyResetMail): MailContent {
  const { common, passkeyReset: copy } = MAIL_CATALOGUES[mail.locale];
  const expiry = formatMessage(copy.expiry, {
    days: formatCount(mail.locale, copy.days, mail.expiresInDays),
  });
  return {
    subject: copy.subject,
    html: htmlDocument(mail.locale, copy.title, [
      heading(copy.heading),
      paragraph(copy.intro),
      linkButton(mail.link, copy.button),
      linkFallback(common, mail.link),
      paragraph(expiry),
      paragraph(copy.contact),
      signOffHtml(common),
    ]),
    text: textBody([
      copy.intro,
      mail.link,
      expiry,
      copy.contact,
      signOffText(common),
    ]),
  };
}
