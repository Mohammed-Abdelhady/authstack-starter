/** Shared names of the unique rules a pending link can run into. */
export const MAGIC_LINK_CONSTRAINT = {
  TOKEN_HASH: 'pending_magic_link.token_hash',
} as const;

export interface NewMagicLink {
  email: string;
  tokenHash: string;
  expiresAt: Date;
  requestIp?: string;
  userAgent?: string;
  redirect?: string;
}

/** A link this caller just spent. Its expiry is the caller's to judge. */
export interface ClaimedMagicLink {
  email: string;
  expiresAt: Date;
  redirect?: string;
}

/**
 * What mailed sign-in links need stored. Each method is one statement that
 * commits by itself.
 *
 * `claimLink` spends a link whether or not it has expired, and hands back its
 * expiry: the service refuses an expired one itself, so nothing depends on
 * cleanup having removed it. `countRequestedSince` counts spent and expired
 * links on purpose, because the hourly cap is on mail sent, not on links that
 * still work.
 */
export abstract class MagicLinkStore {
  /** Links stored for the address since `since`, spent and expired included. */
  abstract countRequestedSince(email: string, since: Date): Promise<number>;

  /** Stores an unspent link. Its creation time is the database's own clock. */
  abstract insertLink(link: NewMagicLink): Promise<void>;

  /**
   * Marks the unspent link with this token hash as spent at `now` and returns
   * it. Null when no link has the hash or it was spent before. Of two callers
   * that claim one link, one gets it.
   */
  abstract claimLink(
    tokenHash: string,
    now: Date,
  ): Promise<ClaimedMagicLink | null>;
}
