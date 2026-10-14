import type {
  MailMessages,
  MessagesOf,
} from '../../types/mail-catalogue.types';

export const REGISTRATION_NOTICE_EN = {
  subject: 'Someone tried to register with your email address',
  attempt:
    'Someone just tried to register an account with this email address. You already have an account, so nothing has changed and no new account was created.',
  ifYou:
    'If this was you, sign in instead. If you have forgotten your password, use the forgot password link on the sign-in page.',
  ifNot: 'If it was not you, you can ignore this email.',
} as const satisfies MailMessages;

export type RegistrationNoticeMessages = MessagesOf<
  typeof REGISTRATION_NOTICE_EN
>;
