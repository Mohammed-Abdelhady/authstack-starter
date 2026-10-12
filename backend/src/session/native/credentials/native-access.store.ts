export const FIRST_USE = {
  MARKED: 'marked',
  NOT_MARKED: 'not_marked',
} as const;

export type FirstUse = (typeof FIRST_USE)[keyof typeof FIRST_USE];

export interface LiveAccessCredential {
  id: string;
  sessionId: string;
  proofKeyThumbprint: string | null;
}

/**
 * What validating a mobile access token needs. The two reads are committed
 * authority reads: fresh, from the primary, outside any unit of work, so they
 * see a revocation that has completed. Each compares the stored expiry with
 * `now` and never relies on expired rows having been removed.
 */
export abstract class NativeAccessStore {
  /** The access token when it is unspent, unended and unexpired at `now`. */
  abstract readCommittedAccessCredential(
    tokenHash: string,
    now: Date,
  ): Promise<LiveAccessCredential | null>;

  /** Marks the first use of a token that is unspent, unended and unused. */
  abstract markFirstUse(credentialId: string, now: Date): Promise<FirstUse>;

  abstract readCommittedAccessIsLive(
    credentialId: string,
    now: Date,
  ): Promise<boolean>;
}
