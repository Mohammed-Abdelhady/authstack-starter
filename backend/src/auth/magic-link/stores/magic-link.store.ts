import { MailWindowRule } from '../../pending-codes/mail-counter.store';

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
  /** Hash of the nonce left with the browser that asked for the link. */
  requestNonceHash?: string;
  /** Set on a link nobody is mailed, so it is stored already spent. */
  consumedAt?: Date;
}

/** A link this caller just spent. Its expiry is the caller's to judge. */
export interface ClaimedMagicLink {
  email: string;
  expiresAt: Date;
  redirect?: string;
}

/** A link nobody has spent yet, read without spending it. */
export interface UnspentMagicLink {
  email: string;
  expiresAt: Date;
  /** Null on a link stored before links were tied to a browser. */
  requestNonceHash: string | null;
}

/**
 * What mailed sign-in links need stored. Each method is one statement that
 * commits by itself.
 *
 * `claimLink` spends a link whether or not it has expired, and hands back its
 * expiry: the service refuses an expired one itself, so nothing depends on
 * cleanup having removed it. The hourly cap is a counter of its own, so
 * removing a link never gives a request back.
 */
export abstract class MagicLinkStore {
  /**
   * Counts one request against the address and says whether it is inside the
   * cap. The database decides: of requests made at once, exactly as many as
   * the cap has left are told yes. A window that started `windowMs` or longer
   * ago starts again at this request.
   */
  abstract takeRequestSlot(
    email: string,
    rule: MailWindowRule,
  ): Promise<boolean>;

  /** Stores a link, unspent unless it says otherwise, created at the database's own clock. */
  abstract insertLink(link: NewMagicLink): Promise<void>;

  /** The unspent link with this token hash, expired or not. Spends nothing. */
  abstract findUnspentLink(tokenHash: string): Promise<UnspentMagicLink | null>;

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
