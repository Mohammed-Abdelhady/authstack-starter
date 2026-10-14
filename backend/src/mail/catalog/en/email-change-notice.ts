import type {
  MailMessages,
  MessagesOf,
} from '../../types/mail-catalogue.types';

export const EMAIL_CHANGE_NOTICE_EN = {
  subject: 'A pending email change was requested',
  title: 'A pending email change was requested',
  body: 'An administrator requested to change the email address on your account. Your existing address remains active until the new address is confirmed. If you did not expect this request, contact your administrator.',
} as const satisfies MailMessages;

export type EmailChangeNoticeMessages = MessagesOf<
  typeof EMAIL_CHANGE_NOTICE_EN
>;
