import type {
  MailMessages,
  MessagesOf,
} from '../../types/mail-catalogue.types';

export const ACCOUNT_ERASURE_EN = {
  subject: 'Your account will be erased',
  title: 'Your account will be erased',
  heading: 'Your account will be erased',
  body: 'Your account was deleted and you were signed out everywhere. On {date} it will be erased with everything that belongs to it, and this cannot be undone.',
  restore:
    'If you did not ask for this, contact support before that date to keep your account.',
} as const satisfies MailMessages;

export type AccountErasureMessages = MessagesOf<typeof ACCOUNT_ERASURE_EN>;
