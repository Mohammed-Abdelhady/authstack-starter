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

interface InvitationMail {
  locale: SupportedLocale;
  link: string;
  expiresInDays: number;
  inviterName?: string;
}

export function buildInvitationMail(mail: InvitationMail): MailContent {
  const { common, invitation: copy } = MAIL_CATALOGUES[mail.locale];
  const intro = mail.inviterName
    ? formatMessage(copy.invitedBy, { name: mail.inviterName })
    : copy.intro;
  const expiry = formatMessage(copy.expiry, {
    days: formatCount(mail.locale, copy.days, mail.expiresInDays),
  });
  return {
    subject: copy.subject,
    html: htmlDocument(mail.locale, copy.title, [
      heading(copy.heading),
      mail.inviterName
        ? paragraph(copy.invitedBy, { name: mail.inviterName })
        : paragraph(copy.intro),
      linkButton(mail.link, copy.button),
      linkFallback(common, mail.link),
      paragraph(expiry),
      paragraph(copy.ignore),
      signOffHtml(common),
    ]),
    text: textBody([
      intro,
      mail.link,
      expiry,
      copy.ignore,
      signOffText(common),
    ]),
  };
}
