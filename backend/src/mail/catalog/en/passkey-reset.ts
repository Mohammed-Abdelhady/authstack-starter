import type {
  MailMessages,
  MessagesOf,
} from '../../types/mail-catalogue.types';

export const PASSKEY_RESET_EN = {
  subject: 'Set up a new passkey',
  title: 'Your passkeys were reset',
  heading: 'Set up a new passkey',
  intro:
    'An administrator reset your passkeys and ended your sessions. Use this link to register a new passkey.',
  button: 'Set up a passkey',
  expiry: 'This link expires in {days}.',
  days: { one: '{count} day', other: '{count} days' },
  contact: 'If you were not expecting this reset, contact your administrators.',
} as const satisfies MailMessages;

export type PasskeyResetMessages = MessagesOf<typeof PASSKEY_RESET_EN>;
