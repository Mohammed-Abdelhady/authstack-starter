import { Collection, Db, ObjectId } from 'mongodb';
import { isMongoDuplicateKeyError } from '../../../../common/persistence/mongo/mongo-error.util';
import {
  MalformedIdError,
  UniqueConflictError,
} from '../../../../common/persistence/persistence-errors';
import type { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { mongoSessionOf } from '../../../../session/persistence/mongo/mongo-unit-of-work';
import {
  AccountDeletionStore,
  DELETION_RECEIPT_CONSTRAINT,
} from '../../stores/account-deletion.store';
import type {
  DeletionRecord,
  StoredDeletionReceipt,
} from '../../types/account-deletion';

export const ACCOUNT_DELETION_RECEIPT_COLLECTION = 'account_deletion_receipts';

type ReceiptDocument = StoredDeletionReceipt & {
  _id: string;
  operation: string;
  purgeAfter: Date;
};

function receiptOf(
  document: ReceiptDocument | null,
): StoredDeletionReceipt | null {
  return document
    ? {
        userId: document.userId,
        eraseAfter: document.eraseAfter,
        recordedAt: document.recordedAt,
      }
    : null;
}

export class MongoAccountDeletionStore extends AccountDeletionStore {
  private readonly receipts: Collection<ReceiptDocument>;

  constructor(private readonly db: Db) {
    super();
    this.receipts = db.collection<ReceiptDocument>(
      ACCOUNT_DELETION_RECEIPT_COLLECTION,
    );
  }

  async ensureIndexes(): Promise<void> {
    await this.receipts.createIndex(
      { purgeAfter: 1 },
      { expireAfterSeconds: 0, name: 'account_deletion_receipt_purge_after' },
    );
  }

  async findReceiptIn(
    unitOfWork: UnitOfWork,
    keyHash: string,
  ): Promise<StoredDeletionReceipt | null> {
    return receiptOf(
      await this.receipts.findOne(
        { _id: keyHash },
        { session: mongoSessionOf(unitOfWork) },
      ),
    );
  }

  async recordIn(
    unitOfWork: UnitOfWork,
    record: DeletionRecord,
  ): Promise<void> {
    const session = mongoSessionOf(unitOfWork);
    if (!ObjectId.isValid(record.userId)) throw new MalformedIdError();
    const userId = new ObjectId(record.userId);
    await this.db
      .collection('users')
      .updateOne(
        { _id: userId },
        record.eraseAfter === null
          ? { $unset: { eraseAfter: '' } }
          : { $set: { eraseAfter: record.eraseAfter } },
        { session },
      );
    if (!record.receipt) return;
    try {
      await this.receipts.insertOne(
        {
          _id: record.receipt.keyHash,
          userId: userId.toHexString(),
          operation: record.receipt.operation,
          eraseAfter: record.eraseAfter,
          recordedAt: record.receipt.recordedAt,
          purgeAfter: record.receipt.purgeAfter,
        },
        { session },
      );
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        throw new UniqueConflictError(DELETION_RECEIPT_CONSTRAINT.KEY, error);
      }
      throw error;
    }
  }

  async findReceipt(keyHash: string): Promise<StoredDeletionReceipt | null> {
    return receiptOf(await this.receipts.findOne({ _id: keyHash }));
  }

  async findEraseAfter(userId: string): Promise<Date | null> {
    if (!ObjectId.isValid(userId)) throw new MalformedIdError();
    const account = await this.db
      .collection<{ _id: ObjectId; isDeleted?: boolean; eraseAfter?: Date }>(
        'users',
      )
      .findOne(
        { _id: new ObjectId(userId), isDeleted: true },
        { projection: { eraseAfter: 1 } },
      );
    return account?.eraseAfter ?? null;
  }
}
