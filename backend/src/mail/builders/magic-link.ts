import type { SupportedLocale } from '../../common/constants/locales';
import { formatMessage } from '../catalog/format-message';
import { MAIL_CATALOGUES } from '../catalog/mail-catalogue';
import type { MailContent } from '../types/mail-catalogue.types';
import {
  heading,
  htmlDocument,
  linkButton,
  linkFallback,
  minutesPhrase,
  paragraph,
  signOffHtml,
  signOffText,
  textBody,
} from './mail-layout';

export interface MagicLinkMail {
  locale: SupportedLocale;
  /** Escaped in the anchor's text and in its href. */
  link: string;
  expiresInMinutes: number;
}

/** A one-time sign-in link, for the web page or a native app's callback. */
export function buildMagicLinkMail(mail: MagicLinkMail): MailContent {
  const { common, magicLink: copy } = MAIL_CATALOGUES[mail.locale];
  const expiry = formatMessage(copy.expiry, {
    minutes: minutesPhrase(mail.locale, mail.expiresInMinutes),
  });
  return {
    subject: copy.subject,
    html: htmlDocument(mail.locale, copy.title, [
      heading(copy.heading),
      paragraph(copy.intro),
      linkButton(mail.link, copy.button),
      linkFallback(common, mail.link),
      paragraph(expiry),
      paragraph(copy.ignore),
      signOffHtml(common),
    ]),
    text: textBody([
      copy.introText,
      mail.link,
      expiry,
      copy.ignore,
      signOffText(common),
    ]),
  };
}
