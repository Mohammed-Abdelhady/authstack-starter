import type {
  MailMessages,
  MessagesOf,
} from '../../types/mail-catalogue.types';

export const OWN_EMAIL_CHANGE_CODE_EN = {
  subject: 'Your code to confirm a new email address',
  title: 'Confirm your new email address',
  heading: 'Confirm your new email address',
  instruction:
    'Someone asked to move an account to this email address. Enter this code where the change was asked for to confirm it:',
  codeLine: 'Code: {code}',
  unexpected:
    'If you did not ask for this, you can ignore this email. No account moves to this address unless the code is entered.',
} as const satisfies MailMessages;

export type OwnEmailChangeCodeMessages = MessagesOf<
  typeof OWN_EMAIL_CHANGE_CODE_EN
>;
