import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import type {
  DeletionRecord,
  StoredDeletionReceipt,
} from '../types/account-deletion';

/** Shared name of the rule that stores a receipt key once. */
export const DELETION_RECEIPT_CONSTRAINT = {
  KEY: 'account_deletion_receipt.key_hash',
} as const;

/**
 * What a person's own deletion writes beside the deactivation: the erasure
 * date, and the receipt a phone asks about when the answer was lost.
 */
export abstract class AccountDeletionStore {
  abstract findReceiptIn(
    unitOfWork: UnitOfWork,
    keyHash: string,
  ): Promise<StoredDeletionReceipt | null>;

  /**
   * Sets `erase_after` (clears it when erasure is off) and stores the
   * receipt. A key already stored is a `UniqueConflictError` named
   * `DELETION_RECEIPT_CONSTRAINT.KEY`.
   */
  abstract recordIn(
    unitOfWork: UnitOfWork,
    record: DeletionRecord,
  ): Promise<void>;

  /** A committed read, for the public receipt route. */
  abstract findReceipt(keyHash: string): Promise<StoredDeletionReceipt | null>;

  /** When a deactivated account is erased; null for any other account. */
  abstract findEraseAfter(userId: string): Promise<Date | null>;
}
