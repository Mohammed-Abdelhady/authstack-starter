/** Why a revocation job was written. */
export const REVOCATION_REASON = {
  ERASURE: 'erasure',
  UNLINK: 'unlink',
  /** Kept at a sign-in that never became a link, such as a refused sign-up. */
  UNCLAIMED: 'unclaimed',
} as const;

export type RevocationReason =
  (typeof REVOCATION_REASON)[keyof typeof REVOCATION_REASON];

export const REVOCATION_STATE = {
  PENDING: 'pending',
  REVOKED: 'revoked',
  CLOSED: 'closed',
} as const;

export type RevocationState =
  (typeof REVOCATION_STATE)[keyof typeof REVOCATION_STATE];

/** How a job ended. The token is gone in every case. */
export const REVOCATION_OUTCOME = {
  REVOKED: 'revoked',
  NO_TOKEN: 'no_token',
  CLOSED_BY_STAFF: 'closed_by_staff',
} as const;

export type RevocationOutcome =
  (typeof REVOCATION_OUTCOME)[keyof typeof REVOCATION_OUTCOME];

/** Why an attempt failed. A code, never a provider's or an error's text. */
export const REVOCATION_FAILURE = {
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  PROVIDER_REFUSED: 'provider_refused',
  REQUEST_FAILED: 'request_failed',
  TOKEN_UNREADABLE: 'token_unreadable',
} as const;

/** Providers whose refresh tokens this server keeps so it can revoke them. */
export const REVOCABLE_PROVIDERS: readonly string[] = [
  'apple', // feature:apple
];

/** After this many failures a job is flagged for staff. It keeps retrying. */
export const REVOCATION_FLAG_AFTER_FAILURES = 5;
/** Every job and its token are gone this long after the job was written. */
export const REVOCATION_KEEP_DAYS = 30;
export const REVOCATION_BATCH_SIZE = 20;
/** A kept token whose identity no account links this long after it was kept is revoked. */
export const REVOCATION_UNCLAIMED_AFTER_MS = 24 * 60 * 60_000;
/** Kept tokens checked for a link per unit of work; a run goes on while one is full. */
export const REVOCATION_CHECK_BATCH_SIZE = 200;
/** Bounds one run's checks, so a store that makes no progress cannot spin. */
export const REVOCATION_CHECK_BATCHES_PER_RUN = 50;
export const REVOCATION_INTERVAL_MS = 5 * 60_000;
/** Longer than one provider call with its timeouts. */
export const REVOCATION_LEASE_MS = 5 * 60_000;
export const REVOCATION_RETRY_BASE_MS = 5 * 60_000;
export const REVOCATION_RETRY_MAX_MS = 24 * 60 * 60_000;
export const REVOCATION_LIST_LIMIT = 100;

/** HKDF labels, so the one setting yields keys that cannot stand in for each other. */
export const PROVIDER_TOKEN_KEY_INFO = 'provider-token-encryption';
export const PROVIDER_TOKEN_KEY_ID_INFO = 'provider-token-key-id';
