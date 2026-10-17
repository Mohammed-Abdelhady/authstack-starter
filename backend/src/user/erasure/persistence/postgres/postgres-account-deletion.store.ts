import type { Kysely, Transaction } from 'kysely';
import { UniqueConflictError } from '../../../../common/persistence/persistence-errors';
import type { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import type { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';
import { mapPostgresError } from '../../../../common/persistence/postgres/postgres-persistence-errors';
import { postgresTransactionOf } from '../../../../common/persistence/postgres/postgres-unit-of-work';
import { toUuid } from '../../../../session/persistence/postgres/postgres-issuance-mappers';
import {
  AccountDeletionStore,
  DELETION_RECEIPT_CONSTRAINT,
} from '../../stores/account-deletion.store';
import type {
  DeletionRecord,
  StoredDeletionReceipt,
} from '../../types/account-deletion';

const RECEIPT_PRIMARY_KEY = 'account_deletion_receipts_pkey';

type Reader = Kysely<PostgresTables> | Transaction<PostgresTables>;

async function receiptOf(
  reader: Reader,
  keyHash: string,
): Promise<StoredDeletionReceipt | null> {
  const row = await reader
    .selectFrom('account_deletion_receipts')
    .select(['user_id', 'erase_after', 'recorded_at'])
    .where('key_hash', '=', keyHash)
    .executeTakeFirst();
  return row
    ? {
        userId: row.user_id,
        eraseAfter: row.erase_after,
        recordedAt: row.recorded_at,
      }
    : null;
}

export class PostgresAccountDeletionStore extends AccountDeletionStore {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  findReceiptIn(
    unitOfWork: UnitOfWork,
    keyHash: string,
  ): Promise<StoredDeletionReceipt | null> {
    return receiptOf(postgresTransactionOf(unitOfWork), keyHash);
  }

  async recordIn(
    unitOfWork: UnitOfWork,
    record: DeletionRecord,
  ): Promise<void> {
    const transaction = postgresTransactionOf(unitOfWork);
    const userId = toUuid(record.userId);
    await transaction
      .updateTable('users')
      .set({
        erase_after: record.eraseAfter,
        self_deleted_at: record.deletedAt,
      })
      .where('id', '=', userId)
      .execute();
    if (!record.receipt) return;
    try {
      await transaction
        .insertInto('account_deletion_receipts')
        .values({
          key_hash: record.receipt.keyHash,
          user_id: userId,
          operation: record.receipt.operation,
          erase_after: record.eraseAfter,
          recorded_at: record.receipt.recordedAt,
          purge_after: record.receipt.purgeAfter,
        })
        .execute();
    } catch (error) {
      const mapped = mapPostgresError(error);
      if (
        mapped instanceof UniqueConflictError &&
        mapped.constraint === RECEIPT_PRIMARY_KEY
      ) {
        throw new UniqueConflictError(DELETION_RECEIPT_CONSTRAINT.KEY, error);
      }
      throw error;
    }
  }

  findReceipt(keyHash: string): Promise<StoredDeletionReceipt | null> {
    return receiptOf(this.database, keyHash);
  }

  async findEraseAfter(userId: string): Promise<Date | null> {
    const row = await this.database
      .selectFrom('users')
      .select('erase_after')
      .where('id', '=', toUuid(userId))
      .where('is_deleted', '=', true)
      .executeTakeFirst();
    return row?.erase_after ?? null;
  }
}
