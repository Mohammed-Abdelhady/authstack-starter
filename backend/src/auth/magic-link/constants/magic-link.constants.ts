/** Entropy of a magic link token, before base64url encoding. */
export const MAGIC_LINK_TOKEN_BYTES = 32;

/** Longest token the verify route reads before rejecting the request. */
export const MAGIC_LINK_MAX_TOKEN_LENGTH = 128;

/** How long a pending link is kept after it expires. */
export const MAGIC_LINK_RETENTION_SECONDS = 3600;

/** Window the per-address cap counts over, from its first request. */
export const MAGIC_LINK_RATE_WINDOW_MS = 3600000;

/**
 * Client page the mailed link points at. It reads the token out of the query
 * string and posts it to the backend, so a scanner that fetches the link does
 * not consume it.
 */
export const MAGIC_LINK_CLIENT_PATH = '/auth/magic-link/verify';

/**
 * Reply to every link request. Addresses with an account, addresses without
 * one and addresses that hit the hourly cap all get this.
 */
export const MAGIC_LINK_SENT_MESSAGE =
  'If the address can sign in, a link has been sent';
