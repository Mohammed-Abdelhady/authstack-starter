import type {
  MailMessages,
  MessagesOf,
} from '../../types/mail-catalogue.types';

export const EMAIL_CHANGE_CODE_EN = {
  subject: 'Confirm your new email address',
  title: 'Confirm Your New Email',
  heading: 'Confirm Your New Email Address',
  instruction:
    'An administrator changed the email address on your account. Open the confirmation page and enter this code to finish the change:',
  button: 'Confirm the new address',
  codeLine: 'Code: {code}',
  unexpected: "If you didn't expect this change, contact your administrator.",
} as const satisfies MailMessages;

export type EmailChangeCodeMessages = MessagesOf<typeof EMAIL_CHANGE_CODE_EN>;
