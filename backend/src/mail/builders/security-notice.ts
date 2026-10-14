import type { SupportedLocale } from '../../common/constants/locales';
import { SECURITY_NOTICE } from '../../user/constants/security-notice.constants';
import type { SecurityNotice } from '../../user/types/security-notice.type';
import type { SecurityNoticeMessages } from '../catalog/en/security-notice';
import { MAIL_CATALOGUES } from '../catalog/mail-catalogue';
import type { MailContent } from '../types/mail-catalogue.types';
import { paragraph, plainTextMail } from './mail-layout';

type NoticeKey = keyof SecurityNoticeMessages;

/** Where each notice's subject and sentence sit in the catalogue. */
const NOTICE_COPY: Readonly<
  Record<SecurityNotice, { subject: NoticeKey; text: NoticeKey }>
> = {
  [SECURITY_NOTICE.PASSWORD_RESET]: {
    subject: 'passwordResetSubject',
    text: 'passwordResetText',
  },
  [SECURITY_NOTICE.PASSWORD_CHANGED]: {
    subject: 'passwordChangedSubject',
    text: 'passwordChangedText',
  },
  [SECURITY_NOTICE.TWO_FACTOR_DISABLED]: {
    subject: 'twoFactorDisabledSubject',
    text: 'twoFactorDisabledText',
  },
  [SECURITY_NOTICE.PASSKEY_ADDED]: {
    subject: 'passkeyAddedSubject',
    text: 'passkeyAddedText',
  },
  [SECURITY_NOTICE.PROVIDER_ADDED]: {
    subject: 'providerAddedSubject',
    text: 'providerAddedText',
  },
};

/** Tells an account holder that a security change was made on the account. */
export function buildSecurityNoticeMail(
  locale: SupportedLocale,
  notice: SecurityNotice,
): MailContent {
  const copy = MAIL_CATALOGUES[locale].securityNotice;
  const keys = NOTICE_COPY[notice];
  const text = copy[keys.text];
  return plainTextMail(locale, {
    subject: copy[keys.subject],
    text,
    blocks: [paragraph(text)],
  });
}
