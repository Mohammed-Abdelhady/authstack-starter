export const BROWSER_PROOF_CONSTRAINT = {
  PROOF_ID: 'browser_proof.proof_id',
} as const;

export const BROWSER_PROOF_CLAIM = {
  CLAIMED: 'claimed',
  ALREADY_CLAIMED: 'already_claimed',
  EXPIRED: 'expired',
  NOT_FOUND: 'not_found',
} as const;

export type BrowserProofClaim =
  (typeof BROWSER_PROOF_CLAIM)[keyof typeof BROWSER_PROOF_CLAIM];

export interface NewBrowserProof {
  proofIdHash: string;
  tokenHash: string;
  expiresAt: Date;
}

/** What the service compares a presented token against. */
export interface IssuedBrowserProof {
  tokenHash: string;
}

/**
 * Single-use proofs a browser shows before it has a session. Each method is one
 * statement that commits by itself: a proof is never part of a unit of work.
 */
export abstract class BrowserProofStore {
  /** A proof id that is already stored is a `UniqueConflictError`. */
  abstract issueBrowserProof(proof: NewBrowserProof): Promise<void>;

  /**
   * The proof with this id, spent, expired or neither. It says nothing about
   * whether the proof can still be used: only `claimBrowserProof` decides that.
   */
  abstract findIssuedBrowserProof(
    proofIdHash: string,
  ): Promise<IssuedBrowserProof | null>;

  /**
   * Spends the proof if it is unspent and expires after `now`, in one guarded
   * write. Of any number of callers at once exactly one is told `claimed`.
   * Expiry is compared here and never left to the cleanup.
   */
  abstract claimBrowserProof(
    proofIdHash: string,
    now: Date,
  ): Promise<BrowserProofClaim>;
}
