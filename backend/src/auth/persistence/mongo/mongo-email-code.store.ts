import { Collection, Db, ObjectId } from 'mongodb';
import { Clock } from '../../../common/services/clock';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { storedAddress } from '../../../common/persistence/stored-address';
import { mongoSessionOf } from '../../../session/persistence/mongo/mongo-unit-of-work';
import {
  EmailCodeKey,
  EmailCodeStore,
  NewEmailCode,
  StoredEmailCode,
  storedEmailCodePurpose,
} from '../../pending-codes/email-code.store';

type EmailCodeDocument = StoredEmailCode & { _id: ObjectId };

export const EMAIL_CODE_COLLECTION = 'email_codes';

function toCode(document: EmailCodeDocument): StoredEmailCode {
  const { _id, ...code } = document;
  return { ...code, purpose: storedEmailCodePurpose(code.purpose) };
}

export class MongoEmailCodeStore extends EmailCodeStore {
  private readonly collection: Collection<EmailCodeDocument>;

  constructor(
    db: Db,
    private readonly clock: Clock,
  ) {
    super();
    this.collection = db.collection<EmailCodeDocument>(EMAIL_CODE_COLLECTION);
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { ownerId: 1, purpose: 1 },
      { unique: true, name: 'email_code_owner_purpose_unique' },
    );
    // Kept until the owner ends, not the code: the owner's wrong guesses live on the row.
    await this.collection.createIndex(
      { purgeAfter: 1 },
      { expireAfterSeconds: 0, name: 'email_code_purge_after' },
    );
  }

  async put(code: NewEmailCode): Promise<StoredEmailCode> {
    const stored = await this.collection.findOneAndUpdate(
      { ownerId: code.ownerId, purpose: code.purpose },
      {
        $set: {
          email: storedAddress(code.email),
          codeHash: code.codeHash,
          expiresAt: code.expiresAt,
          purgeAfter: code.purgeAfter,
          spentAt: code.spent ? this.clock.now() : null,
        },
        $setOnInsert: { wrongGuesses: 0 },
      },
      { upsert: true, returnDocument: 'after' },
    );
    if (!stored) throw new Error('MongoDB returned no stored email code');
    return toCode(stored);
  }

  async find(key: EmailCodeKey): Promise<StoredEmailCode | null> {
    const found = await this.collection.findOne({
      ownerId: key.ownerId,
      purpose: key.purpose,
    });
    return found ? toCode(found) : null;
  }

  async findIn(
    work: UnitOfWork,
    key: EmailCodeKey,
  ): Promise<StoredEmailCode | null> {
    const found = await this.collection.findOne(
      { ownerId: key.ownerId, purpose: key.purpose },
      { session: mongoSessionOf(work) },
    );
    return found ? toCode(found) : null;
  }

  /** One pipeline update: the second stage reads the count the first wrote. */
  async recordWrongGuess(
    key: EmailCodeKey,
    limit: number,
  ): Promise<number | null> {
    const updated = await this.collection.findOneAndUpdate(
      { ownerId: key.ownerId, purpose: key.purpose },
      [
        { $set: { wrongGuesses: { $add: ['$wrongGuesses', 1] } } },
        {
          $set: {
            spentAt: {
              $cond: [
                { $gte: ['$wrongGuesses', limit] },
                { $ifNull: ['$spentAt', this.clock.now()] },
                '$spentAt',
              ],
            },
          },
        },
      ],
      { returnDocument: 'after' },
    );
    return updated ? updated.wrongGuesses : null;
  }

  async deliverIn(
    work: UnitOfWork,
    key: EmailCodeKey,
    delivery: { pendingHash: string; codeHash: string; limit: number },
  ): Promise<boolean> {
    if (delivery.pendingHash === delivery.codeHash) return false;
    const changed = await this.collection.updateOne(
      {
        ownerId: key.ownerId,
        purpose: key.purpose,
        codeHash: delivery.pendingHash,
        spentAt: { $ne: null },
        expiresAt: { $gt: this.clock.now() },
        wrongGuesses: { $lt: delivery.limit },
      },
      { $set: { codeHash: delivery.codeHash, spentAt: null } },
      { session: mongoSessionOf(work) },
    );
    return changed.modifiedCount === 1;
  }

  async cancelIn(
    work: UnitOfWork,
    key: EmailCodeKey,
    codeHash: string,
  ): Promise<boolean> {
    const changed = await this.collection.updateOne(
      {
        ownerId: key.ownerId,
        purpose: key.purpose,
        codeHash,
      },
      { $set: { codeHash: '', spentAt: this.clock.now() } },
      { session: mongoSessionOf(work) },
    );
    return changed.modifiedCount === 1;
  }

  async spendIn(
    unitOfWork: UnitOfWork,
    key: EmailCodeKey,
    code: { codeHash: string; limit: number },
  ): Promise<boolean> {
    const now = this.clock.now();
    const result = await this.collection.updateOne(
      {
        ownerId: key.ownerId,
        purpose: key.purpose,
        codeHash: code.codeHash,
        spentAt: null,
        expiresAt: { $gt: now },
        wrongGuesses: { $lt: code.limit },
      },
      { $set: { spentAt: now } },
      { session: mongoSessionOf(unitOfWork) },
    );
    return result.modifiedCount === 1;
  }
}
