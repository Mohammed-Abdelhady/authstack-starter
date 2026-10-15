import type { MailRecipient } from '../../../mail/types/mail-recipient.types';
import type {
  FRESH_PROOF_KIND,
  FRESH_PROOF_REQUIREMENT,
} from '../constants/fresh-proof';

/** Server-owned evidence for this act, not account-global last-proof state. */
export type FreshProofAct =
  | {
      readonly kind: typeof FRESH_PROOF_KIND.PASSKEY;
      readonly userId: string;
      readonly clientId: string;
      readonly sessionId: string;
      readonly rpId: string;
      readonly userVerified: boolean;
      readonly provedAt: Date;
    }
  | {
      readonly kind: typeof FRESH_PROOF_KIND.EMAIL_CODE;
      readonly userId: string;
      readonly clientId: string;
      readonly sessionId: string;
      readonly provedAt: Date;
    };

/** The caller supplies the currently authenticated session's trusted facts. */
export interface FreshProofInput {
  readonly userId: string;
  readonly clientId: string;
  readonly sessionId: string;
  readonly signedInAt: Date;
  readonly requirement:
    | typeof FRESH_PROOF_REQUIREMENT.ACT
    | typeof FRESH_PROOF_REQUIREMENT.ACT_OR_AGE;
  readonly requirePasskey: boolean;
  readonly rpId?: string;
  readonly act?: FreshProofAct;
}

export interface FreshProofMail {
  readonly recipient: MailRecipient;
  readonly code: string;
  readonly expiresInMinutes: number;
}
