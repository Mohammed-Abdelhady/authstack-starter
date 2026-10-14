import type {
  MailMessages,
  MessagesOf,
} from '../../types/mail-catalogue.types';

export const PASSWORD_RESET_CODE_EN = {
  subject: 'Reset Your Password',
  title: 'Reset Your Password',
  heading: 'Reset Your Password',
  instruction:
    'You requested to reset your password. Please use the following 6-digit code to reset your password:',
  ignore:
    "If you didn't request this code, you can safely ignore this email. Your password will remain unchanged.",
} as const satisfies MailMessages;

export type PasswordResetCodeMessages = MessagesOf<
  typeof PASSWORD_RESET_CODE_EN
>;
