import type {
  MailMessages,
  MessagesOf,
} from '../../types/mail-catalogue.types';

export const COMMON_EN = {
  greeting: 'Hi,',
  greetingNamed: 'Hi {name},',
  signOff: 'Best regards,',
  team: 'The Team',
  buttonFallback:
    'If the button does not work, paste this address into your browser:',
  codeExpiry: 'This code will expire in {minutes}.',
  minutes: { one: '{count} minute', other: '{count} minutes' },
} as const satisfies MailMessages;

export type CommonMessages = MessagesOf<typeof COMMON_EN>;
