import type {
  MailMessages,
  MessagesOf,
} from '../../types/mail-catalogue.types';

export const MAGIC_LINK_EN = {
  subject: 'Your Sign-In Link',
  title: 'Your Sign-In Link',
  heading: 'Your Sign-In Link',
  intro: 'Use this link to sign in. It works once.',
  introText: 'Use this link to sign in. It works once:',
  button: 'Sign in',
  expiry: 'The link expires in {minutes}.',
  ignore: 'If you did not request this, ignore this email.',
} as const satisfies MailMessages;

export type MagicLinkMessages = MessagesOf<typeof MAGIC_LINK_EN>;
