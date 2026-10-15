import type {
  MailMessages,
  MessagesOf,
} from '../../types/mail-catalogue.types';

export const PROOF_CODE_EN = {
  subject: 'Confirm your identity',
  title: 'Confirm your identity',
  heading: 'Confirm your identity',
  instruction: 'Enter this code to confirm the action you requested:',
  codeLine: 'Code: {code}',
  unexpected:
    'If you did not request this code, do not share it. You can ignore this message.',
} as const satisfies MailMessages;

export type ProofCodeMessages = MessagesOf<typeof PROOF_CODE_EN>;
