import type { SecurityNotice } from '../types/security-notice.type';

export const SECURITY_NOTICE = {
  PASSWORD_RESET: 'password_reset',
  PASSWORD_CHANGED: 'password_changed',
  TWO_FACTOR_DISABLED: 'two_factor_disabled',
  PASSKEY_ADDED: 'passkey_added',
  PROVIDER_ADDED: 'provider_added',
} as const;

export const SECURITY_NOTICE_MESSAGES: Record<
  SecurityNotice,
  { subject: string; text: string }
> = {
  password_reset: {
    subject: 'Your password was reset',
    text: 'The password for your account was reset. If this was not you, contact support immediately.',
  },
  password_changed: {
    subject: 'Your password was changed',
    text: 'The password for your account was changed. If this was not you, contact support immediately.',
  },
  two_factor_disabled: {
    subject: 'Two-factor authentication was disabled',
    text: 'Two-factor authentication was disabled on your account. If this was not you, contact support immediately.',
  },
  passkey_added: {
    subject: 'A passkey was added',
    text: 'A passkey was added to your account. If this was not you, contact support immediately.',
  },
  provider_added: {
    subject: 'A sign-in provider was added',
    text: 'A sign-in provider was linked to your account. If this was not you, contact support immediately.',
  },
};
