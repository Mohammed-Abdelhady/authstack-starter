import { hashToken } from '../../../session/utils/hashing/token-hash';
import {
  DELETION_RECEIPT_KEEP_DAYS,
  DELETION_RECEIPT_KEY_PATTERN,
  DELETION_RECEIPT_STATE,
  type DeletionReceiptState,
} from '../constants/deletion-receipt.constants';
import { MS_PER_DAY } from '../constants/erasure.constants';
import type {
  ReceiptKey,
  StoredDeletionReceipt,
} from '../types/account-deletion';

const RECEIPT_KEEP_MS = DELETION_RECEIPT_KEEP_DAYS * MS_PER_DAY;

/** The key's time and its stored hash, or null for a malformed key. */
export function parseReceiptKey(raw: string): ReceiptKey | null {
  const issuedAt = DELETION_RECEIPT_KEY_PATTERN.exec(raw)?.[1];
  if (issuedAt === undefined) return null;
  const milliseconds = Number.parseInt(issuedAt, 10);
  if (!Number.isSafeInteger(milliseconds)) return null;
  return { issuedAt: new Date(milliseconds), hash: hashToken(raw) };
}

/** When a receipt recorded now stops being kept. */
export function receiptPurgeAfter(recordedAt: Date): Date {
  return new Date(recordedAt.getTime() + RECEIPT_KEEP_MS);
}

/**
 * A stored receipt is `recorded` for 90 days from when it was written. Without
 * one, a key younger than 90 days was never recorded as far as the server
 * knows, and an older one may have been and was since purged.
 */
export function receiptState(
  key: ReceiptKey,
  receipt: StoredDeletionReceipt | null,
  now: Date,
): DeletionReceiptState {
  const since = receipt?.recordedAt ?? key.issuedAt;
  if (now.getTime() - since.getTime() > RECEIPT_KEEP_MS) {
    return DELETION_RECEIPT_STATE.UNKNOWN;
  }
  return receipt
    ? DELETION_RECEIPT_STATE.RECORDED
    : DELETION_RECEIPT_STATE.NOT_RECORDED;
}
