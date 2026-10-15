import type {
  MailMessages,
  MessagesOf,
} from '../../types/mail-catalogue.types';

export const SIGN_IN_CODE_EN = {
  subject: 'Your sign-in code: {code}',
  title: 'Your sign-in code',
  heading: 'Your sign-in code',
  instruction: 'Enter this code in the app to sign in:',
  codeLine: 'Code: {code}',
  button: 'Sign in on this phone',
  buttonText: 'Or open this link on the phone where you asked for the code:',
  ignore: 'If you did not ask to sign in, ignore this email.',
} as const satisfies MailMessages;

export type SignInCodeMessages = MessagesOf<typeof SIGN_IN_CODE_EN>;
