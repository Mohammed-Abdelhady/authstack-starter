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
  /** The erasure is due at once: the mail names no time and offers no wait. */
  dueNow: boolean;
}

/**
 * The time in the reader's language with Western digits, as the app shows
 * dates. A mail cannot know the reader's zone, so it names the one it uses.
 */
function erasureTime(locale: SupportedLocale, at: Date): string {
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(at);
}

/** Sent when a person deletes their account: when it will be erased. */
export function buildAccountErasureMail(mail: AccountErasureMail): MailContent {
  const { common, accountErasure: copy } = MAIL_CATALOGUES[mail.locale];
  if (mail.dueNow) {
    return {
      subject: copy.subjectNow,
      html: htmlDocument(mail.locale, copy.titleNow, [
        heading(copy.headingNow),
        paragraph(common.greeting),
        paragraph(copy.bodyNow),
        signOffHtml(common),
      ]),
      text: textBody([common.greeting, copy.bodyNow, signOffText(common)]),
    };
  }
  const date = erasureTime(mail.locale, mail.eraseAfter);
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
