import type {
  MailMessages,
  MessagesOf,
} from '../../types/mail-catalogue.types';

export const INVITATION_EN = {
  subject: 'Your invitation',
  title: 'Accept your invitation',
  heading: 'You have been invited',
  intro: 'You have been invited to create an account.',
  invitedBy: '{name} has invited you to create an account.',
  button: 'Accept invitation',
  expiry: 'This link expires in {days}.',
  days: { one: '{count} day', other: '{count} days' },
  ignore: 'If you were not expecting this invitation, ignore this email.',
} as const satisfies MailMessages;

export type InvitationMessages = MessagesOf<typeof INVITATION_EN>;
