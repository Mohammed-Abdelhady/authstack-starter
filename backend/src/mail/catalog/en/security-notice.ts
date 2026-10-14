import type {
  MailMessages,
  MessagesOf,
} from '../../types/mail-catalogue.types';

export const SECURITY_NOTICE_EN = {
  passwordResetSubject: 'Your password was reset',
  passwordResetText:
    'The password for your account was reset. If this was not you, contact support immediately.',
  passwordChangedSubject: 'Your password was changed',
  passwordChangedText:
    'The password for your account was changed. If this was not you, contact support immediately.',
  twoFactorDisabledSubject: 'Two-factor authentication was disabled',
  twoFactorDisabledText:
    'Two-factor authentication was disabled on your account. If this was not you, contact support immediately.',
  passkeyAddedSubject: 'A passkey was added',
  passkeyAddedText:
    'A passkey was added to your account. If this was not you, contact support immediately.',
  providerAddedSubject: 'A sign-in provider was added',
  providerAddedText:
    'A sign-in provider was linked to your account. If this was not you, contact support immediately.',
} as const satisfies MailMessages;

export type SecurityNoticeMessages = MessagesOf<typeof SECURITY_NOTICE_EN>;
