import type { MailRecipient } from '../../../mail/types/mail-recipient.types';

/** A receipt key as a request sent it, and the hash that is stored. */
export interface ReceiptKey {
  issuedAt: Date;
  hash: string;
}

export interface StoredDeletionReceipt {
  userId: string;
  eraseAfter: Date | null;
  recordedAt: Date;
}

export interface NewDeletionReceipt {
  keyHash: string;
  operation: string;
  recordedAt: Date;
  purgeAfter: Date;
}

/** What the deactivating unit of work writes beside the deactivation. */
export interface DeletionRecord {
  userId: string;
  /** The deactivation's own time, kept as the mark of a person's own deletion. */
  deletedAt: Date;
  /** Null while erasure is off: the account is only deactivated. */
  eraseAfter: Date | null;
  receipt?: NewDeletionReceipt;
}

/** What the request is answered, and who is mailed once it commits. */
export interface DeletionOutcome {
  eraseAfter?: Date;
  /** Absent for a repeated request: its first one mailed already. */
  recipient?: MailRecipient;
}
