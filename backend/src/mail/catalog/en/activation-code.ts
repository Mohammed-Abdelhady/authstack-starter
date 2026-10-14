import type {
  MailMessages,
  MessagesOf,
} from '../../types/mail-catalogue.types';

export const ACTIVATION_CODE_EN = {
  subject: 'Verify Your Email Address',
  title: 'Verify Your Email',
  heading: 'Verify Your Email Address',
  thanks: 'Thank you for registering!',
  instruction:
    'Please use the following 6-digit verification code to complete your registration:',
  ignore: "If you didn't request this code, you can safely ignore this email.",
} as const satisfies MailMessages;

export type ActivationCodeMessages = MessagesOf<typeof ACTIVATION_CODE_EN>;
