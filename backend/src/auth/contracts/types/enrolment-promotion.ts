import type { VerifiedPasskeyProof } from './passkey-proof';

export interface EnrolmentPromotionInput {
  readonly sessionId: string;
  readonly userId: string;
  readonly clientId: string;
  readonly proof: VerifiedPasskeyProof;
}

export interface PromotedEnrolmentSession {
  readonly clientId: string;
  readonly sessionToken: string;
  readonly csrfToken: string;
}
