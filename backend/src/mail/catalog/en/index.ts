import { PASSKEY_RESET_EN } from './passkey-reset'; // feature:invitations
import { INVITATION_EN } from './invitation'; // feature:invitations
import type { MailCatalogue } from '../mail-catalogue';
import { ACTIVATION_CODE_EN } from './activation-code';
import { COMMON_EN } from './common';
import { EMAIL_CHANGE_CODE_EN } from './email-change-code';
import { EMAIL_CHANGE_NOTICE_EN } from './email-change-notice';
import { MAGIC_LINK_EN } from './magic-link';
import { PASSWORD_RESET_CODE_EN } from './password-reset-code';
import { PROOF_CODE_EN } from './proof-code';
import { REGISTRATION_NOTICE_EN } from './registration-notice';
import { SECURITY_NOTICE_EN } from './security-notice';
import { SIGN_IN_CODE_EN } from './sign-in-code'; // feature:email-code

export const EN_MAIL_CATALOGUE: MailCatalogue = {
  common: COMMON_EN,
  activationCode: ACTIVATION_CODE_EN,
  emailChangeCode: EMAIL_CHANGE_CODE_EN,
  emailChangeNotice: EMAIL_CHANGE_NOTICE_EN,
  passwordResetCode: PASSWORD_RESET_CODE_EN,
  proofCode: PROOF_CODE_EN,
  magicLink: MAGIC_LINK_EN,
  registrationNotice: REGISTRATION_NOTICE_EN,
  securityNotice: SECURITY_NOTICE_EN,
  signInCode: SIGN_IN_CODE_EN, // feature:email-code
  invitation: INVITATION_EN, // feature:invitations
  passkeyReset: PASSKEY_RESET_EN, // feature:invitations
};
