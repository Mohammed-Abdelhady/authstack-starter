import type { SupportedLocale } from '../../common/constants/locales';
import type { TextDirection } from '../types/mail-catalogue.types';
import { AR_MAIL_CATALOGUE } from './ar'; // feature:locale-ar
import type { ActivationCodeMessages } from './en/activation-code';
import type { CommonMessages } from './en/common';
import type { EmailChangeCodeMessages } from './en/email-change-code';
import type { EmailChangeNoticeMessages } from './en/email-change-notice';
import type { MagicLinkMessages } from './en/magic-link';
import type { PasswordResetCodeMessages } from './en/password-reset-code';
import type { ProofCodeMessages } from './en/proof-code';
import type { RegistrationNoticeMessages } from './en/registration-notice';
import type { SecurityNoticeMessages } from './en/security-notice';
import type { OwnEmailChangeCodeMessages } from './en/own-email-change-code';
import { EN_MAIL_CATALOGUE } from './en';

/** Every mail's messages in one language, keyed by mail name. */
export type MailCatalogue = {
  readonly common: CommonMessages;
  readonly activationCode: ActivationCodeMessages;
  readonly emailChangeCode: EmailChangeCodeMessages;
  readonly emailChangeNotice: EmailChangeNoticeMessages;
  readonly passwordResetCode: PasswordResetCodeMessages;
  readonly proofCode: ProofCodeMessages;
  readonly magicLink: MagicLinkMessages;
  readonly registrationNotice: RegistrationNoticeMessages;
  readonly securityNotice: SecurityNoticeMessages;
  readonly ownEmailChangeCode: OwnEmailChangeCodeMessages;
};

type ByLocale<Value> = Readonly<Record<SupportedLocale, Value>>;

export const MAIL_CATALOGUES: ByLocale<MailCatalogue> = {
  en: EN_MAIL_CATALOGUE,
  ar: AR_MAIL_CATALOGUE, // feature:locale-ar
};

export const LOCALE_DIRECTION: ByLocale<TextDirection> = {
  en: 'ltr',
  ar: 'rtl', // feature:locale-ar
};
