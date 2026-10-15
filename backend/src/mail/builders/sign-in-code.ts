import type { SupportedLocale } from '../../common/constants/locales';
import { formatMessage } from '../catalog/format-message';
import { MAIL_CATALOGUES } from '../catalog/mail-catalogue';
import { MAIL_COLOR } from '../constants/mail-colors';
import type { MailBlock } from '../types/mail-block.types';
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

export interface SignInCodeMail {
  locale: SupportedLocale;
  /** Western digits in every language, the way the app's input reads them. */
  code: string;
  expiresInMinutes: number;
  /** The app's callback, parameters after `#`. Null without an email link. */
  link: string | null;
}

/** A sign-in code, with a button that finishes the same attempt on this phone. */
export function buildSignInCodeMail(mail: SignInCodeMail): MailContent {
  const { common, signInCode: copy } = MAIL_CATALOGUES[mail.locale];
  const expiry = codeExpiry(mail.locale, mail.expiresInMinutes);
  const buttonBlocks: MailBlock[] = mail.link
    ? [linkButton(mail.link, copy.button), linkFallback(common, mail.link)]
    : [];
  const buttonText = mail.link ? [copy.buttonText, mail.link] : [];
  return {
    subject: formatMessage(copy.subject, { code: mail.code }),
    html: htmlDocument(mail.locale, copy.title, [
      heading(copy.heading),
      paragraph(copy.instruction),
      codeBlock(mail.code, MAIL_COLOR.PRIMARY),
      ...buttonBlocks,
      paragraph(expiry),
      paragraph(copy.ignore),
      signOffHtml(common),
    ]),
    text: textBody([
      copy.instruction,
      formatMessage(copy.codeLine, { code: mail.code }),
      ...buttonText,
      expiry,
      copy.ignore,
      signOffText(common),
    ]),
  };
}
