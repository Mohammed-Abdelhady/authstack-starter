import type { SupportedLocale } from '../../common/constants/locales';
import { MAIL_CATALOGUES } from '../catalog/mail-catalogue';
import type { MailContent } from '../types/mail-catalogue.types';
import {
  bareHtmlDocument,
  paragraph,
  signOffHtml,
  signOffText,
  textBody,
} from './mail-layout';

/** Tells the current mailbox that an admin asked to move the account. */
export function buildEmailChangeNoticeMail(
  locale: SupportedLocale,
): MailContent {
  const { common, emailChangeNotice: copy } = MAIL_CATALOGUES[locale];
  return {
    subject: copy.subject,
    html: bareHtmlDocument(locale, copy.title, [
      paragraph(common.greeting),
      paragraph(copy.body),
      signOffHtml(common),
    ]),
    text: textBody([common.greeting, copy.body, signOffText(common)]),
  };
}
