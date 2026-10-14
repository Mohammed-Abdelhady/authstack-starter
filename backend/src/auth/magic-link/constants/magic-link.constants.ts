/** Entropy of a magic link token, before base64url encoding. */
export const MAGIC_LINK_TOKEN_BYTES = 32;

/** Longest token the verify route reads before rejecting the request. */
export const MAGIC_LINK_MAX_TOKEN_LENGTH = 128;

/** How long a pending link is kept after it expires. */
export const MAGIC_LINK_RETENTION_SECONDS = 3600;

/** Window the per-address cap counts over, from its first request. */
export const MAGIC_LINK_RATE_WINDOW_MS = 3600000;

/**
 * Reply to every link request. Addresses with an account, addresses without
 * one and addresses that hit the hourly cap all get this.
 */
export const MAGIC_LINK_SENT_MESSAGE =
  'If the address can sign in, a link has been sent';

/** Reply to a link that has to be confirmed before it signs anyone in. */
export const MAGIC_LINK_CONFIRM_MESSAGE = 'Confirm this sign-in to continue';

export const MAGIC_LINK_INVALID_MESSAGE =
  'This sign-in link is no longer valid. Request a new one.';

/** Cookie that holds the nonce of the browser a link was asked from. */
export const MAGIC_LINK_NONCE_COOKIE = 'ml_nonce';
export const MAGIC_LINK_NONCE_HOST_COOKIE = '__Host-ml_nonce';

/** A nonce as this server makes one: 32 random bytes in base64url. */
export const MAGIC_LINK_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
