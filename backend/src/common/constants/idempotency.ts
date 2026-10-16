/** Request header a staff create carries its idempotency key in. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** A UUID fits. Anything else a client could put in a header does not. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** How long a create's key and its result are kept: 24 hours. */
export const IDEMPOTENCY_KEY_LIFETIME_MS = 86_400_000;
