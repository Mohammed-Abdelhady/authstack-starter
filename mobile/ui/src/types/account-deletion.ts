import type { AbortSignalPort } from '@app/native-auth';
import type { Transport } from '@app/sdk';

export interface DeletionReceiptStorage {
  read(): Promise<string | null>;
  write(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface AccountDeletionProps {
  randomBytes: (length: number) => Promise<Uint8Array>;
  receipts: DeletionReceiptStorage;
  onDeleted: () => void;
  /**
   * A transport that sends no credential, for the public receipt route. The
   * deletion ends the session the engine's transport needs, so after a lost
   * answer or a restart only this one can still ask. Without it the engine's
   * transport asks, which works while its tokens are still held.
   */
  receiptTransport?: Transport<AbortSignalPort>;
}
