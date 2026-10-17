import { THROTTLE_TTL_15_MIN } from '../../../common/constants/throttle';

/** What the public receipt route answers. It never names an account. */
export const DELETION_RECEIPT_STATE = {
  RECORDED: 'recorded',
  /** Not proof of failure: the first request may still be on its way. */
  NOT_RECORDED: 'not_recorded',
  /** The key or its receipt is older than the receipts are kept. */
  UNKNOWN: 'unknown',
} as const;

export type DeletionReceiptState =
  (typeof DELETION_RECEIPT_STATE)[keyof typeof DELETION_RECEIPT_STATE];

/** The one operation a receipt records today. */
export const DELETION_OPERATION = {
  ACCOUNT_DELETION: 'account_deletion',
} as const;

/**
 * `r1.<epoch ms the client made it>.<32 random bytes as hex>`. The time lets
 * the server answer `unknown` once a purged receipt would have been older
 * than it keeps them.
 */
export const DELETION_RECEIPT_KEY_PATTERN = /^r1\.(\d{1,15})\.([0-9a-f]{64})$/;

export const DELETION_RECEIPT_KEEP_DAYS = 90;

export const THROTTLE_DELETION_RECEIPT = {
  default: { limit: 30, ttl: THROTTLE_TTL_15_MIN },
} as const;
