import type { SupportedLocale } from '../../common/constants/locales';
import { formatMessage } from '../catalog/format-message';
import { MAIL_CATALOGUES } from '../catalog/mail-catalogue';
import type { MailContent } from '../types/mail-catalogue.types';
import {
  heading,
  htmlDocument,
  paragraph,
  signOffHtml,
  signOffText,
  textBody,
} from './mail-layout';

export interface AccountErasureMail {
  locale: SupportedLocale;
  eraseAfter: Date;
}

/** The day in the reader's language, with Western digits, as the app shows dates. */
function erasureDay(locale: SupportedLocale, day: Date): string {
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(day);
}

/** Sent when a person deletes their account: the day it will be erased. */
export function buildAccountErasureMail(mail: AccountErasureMail): MailContent {
  const { common, accountErasure: copy } = MAIL_CATALOGUES[mail.locale];
  const date = erasureDay(mail.locale, mail.eraseAfter);
  return {
    subject: copy.subject,
    html: htmlDocument(mail.locale, copy.title, [
      heading(copy.heading),
      paragraph(common.greeting),
      paragraph(copy.body, { date }),
      paragraph(copy.restore),
      signOffHtml(common),
    ]),
    text: textBody([
      common.greeting,
      formatMessage(copy.body, { date }),
      copy.restore,
      signOffText(common),
    ]),
  };
}
