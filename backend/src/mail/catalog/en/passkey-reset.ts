import type {
  MailMessages,
  MessagesOf,
} from '../../types/mail-catalogue.types';

export const PASSKEY_RESET_EN = {
  subject: 'Set up a new passkey',
  title: 'Register a new passkey',
  heading: 'Set up a new passkey',
  intro: 'Use this link to register a new passkey for your account.',
  button: 'Set up a passkey',
  expiry: 'This link expires in {days}.',
  days: { one: '{count} day', other: '{count} days' },
  contact: 'If you were not expecting this link, contact your administrators.',
} as const satisfies MailMessages;

export type PasskeyResetMessages = MessagesOf<typeof PASSKEY_RESET_EN>;
