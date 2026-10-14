import type { SupportedLocale } from '../../common/constants/locales';
import { formatMessage } from '../catalog/format-message';
import { MAIL_CATALOGUES } from '../catalog/mail-catalogue';
import type { MailContent } from '../types/mail-catalogue.types';
import {
  paragraph,
  plainTextMail,
  signOffHtml,
  signOffText,
  textBody,
} from './mail-layout';

export interface RegistrationNoticeMail {
  locale: SupportedLocale;
  name: string;
}

/**
 * Tells an account holder that their address was used in a registration, in
 * place of an activation code.
 */
export function buildRegistrationNoticeMail(
  mail: RegistrationNoticeMail,
): MailContent {
  const { common, registrationNotice: copy } = MAIL_CATALOGUES[mail.locale];
  const names = { name: mail.name };
  const greeting = formatMessage(common.greetingNamed, names);
  const rest = [copy.attempt, copy.ifYou, copy.ifNot];
  return plainTextMail(mail.locale, {
    subject: copy.subject,
    text: textBody([greeting, ...rest, signOffText(common)]),
    blocks: [
      paragraph(common.greetingNamed, names),
      ...rest.map((message) => paragraph(message)),
      signOffHtml(common),
    ],
  });
}
