import type { MailCatalogue } from '../mail-catalogue';
import { ACTIVATION_CODE_AR } from './activation-code';
import { COMMON_AR } from './common';
import { EMAIL_CHANGE_CODE_AR } from './email-change-code';
import { EMAIL_CHANGE_NOTICE_AR } from './email-change-notice';
import { MAGIC_LINK_AR } from './magic-link';
import { PASSWORD_RESET_CODE_AR } from './password-reset-code';
import { REGISTRATION_NOTICE_AR } from './registration-notice';
import { SECURITY_NOTICE_AR } from './security-notice';

export const AR_MAIL_CATALOGUE: MailCatalogue = {
  common: COMMON_AR,
  activationCode: ACTIVATION_CODE_AR,
  emailChangeCode: EMAIL_CHANGE_CODE_AR,
  emailChangeNotice: EMAIL_CHANGE_NOTICE_AR,
  passwordResetCode: PASSWORD_RESET_CODE_AR,
  magicLink: MAGIC_LINK_AR,
  registrationNotice: REGISTRATION_NOTICE_AR,
  securityNotice: SECURITY_NOTICE_AR,
};
