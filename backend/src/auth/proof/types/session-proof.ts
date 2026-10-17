import type { FRESH_PROOF_KIND } from '../../contracts/constants/fresh-proof';

export type ProofKind =
  (typeof FRESH_PROOF_KIND)[keyof typeof FRESH_PROOF_KIND];

/** The session a proof belongs to. All three must match on every read. */
export interface ProofSessionRef {
  readonly sessionId: string;
  readonly userId: string;
  readonly clientId: string;
}

/** A challenge waiting for its answer: a passkey assertion or a mailed code. */
export interface OpenProofChallenge extends ProofSessionRef {
  readonly kind: ProofKind;
  /** SHA-256 of the WebAuthn challenge, or the bcrypt hash of the code. */
  readonly challengeHash: string;
  readonly expiresAt: Date;
  readonly purgeAfter: Date;
}

export interface StoredProofChallenge {
  readonly kind: ProofKind;
  readonly challengeHash: string;
  readonly expiresAt: Date;
  readonly wrongGuesses: number;
}

/** What a passed challenge leaves on the session. */
export interface RecordedProof extends ProofSessionRef {
  readonly kind: ProofKind;
  /** The relying party a passkey proof was made for. */
  readonly rpId?: string;
  readonly userVerified: boolean;
  readonly provedAt: Date;
  readonly purgeAfter: Date;
}
