import type { SupportedLocale } from '../../common/constants/locales';
import { SECURITY_NOTICE } from '../../user/constants/security-notice.constants';
import type {
  SecurityNotice,
  SecurityNoticeFacts,
} from '../../user/types/security-notice.type';
import type { SecurityNoticeMessages } from '../catalog/en/security-notice';
import { formatMessage } from '../catalog/format-message';
import { MAIL_CATALOGUES } from '../catalog/mail-catalogue';
import type { MailContent } from '../types/mail-catalogue.types';
import { paragraph, plainTextMail, textBody } from './mail-layout';
import { factsSentence } from './security-notice-facts';

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
  [SECURITY_NOTICE.PASSKEY_REMOVED]: {
    subject: 'passkeyRemovedSubject',
    text: 'passkeyRemovedText',
  },
  [SECURITY_NOTICE.EMAIL_CHANGE_REQUESTED]: {
    subject: 'emailChangeRequestedSubject',
    text: 'emailChangeRequestedText',
  },
  [SECURITY_NOTICE.EMAIL_CHANGED]: {
    subject: 'emailChangedSubject',
    text: 'emailChangedText',
  },
  [SECURITY_NOTICE.NEW_DEVICE]: {
    subject: 'newDeviceSubject',
    text: 'newDeviceText',
  },
  [SECURITY_NOTICE.ACCOUNT_DEACTIVATED]: {
    subject: 'accountDeactivatedSubject',
    text: 'accountDeactivatedText',
  },
  [SECURITY_NOTICE.ACCOUNT_RESTORED]: {
    subject: 'accountRestoredSubject',
    text: 'accountRestoredText',
  },
  [SECURITY_NOTICE.PASSKEYS_RESET]: {
    subject: 'passkeysResetSubject',
    text: 'passkeysResetText',
  },
};

/**
 * Tells an account holder that a security change was made on the account.
 * With facts it also says when, and from which device. A notice carries no
 * code, token or link.
 */
export function buildSecurityNoticeMail(
  locale: SupportedLocale,
  notice: SecurityNotice,
  facts?: SecurityNoticeFacts,
): MailContent {
  const copy = MAIL_CATALOGUES[locale].securityNotice;
  const keys = NOTICE_COPY[notice];
  const text = copy[keys.text];
  if (facts === undefined) {
    return plainTextMail(locale, {
      subject: copy[keys.subject],
      text,
      blocks: [paragraph(text)],
    });
  }
  const sentence = factsSentence(locale, copy, notice, facts);
  return plainTextMail(locale, {
    subject: copy[keys.subject],
    text: textBody([text, formatMessage(sentence.message, sentence.args)]),
    blocks: [paragraph(text), paragraph(sentence.message, sentence.args)],
  });
}
