import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { PENDING_PURPOSE } from '../../constants/registration';
import { toObjectId } from '../../../session/persistence/mongo/mongo-issuance-mappers';
import { mongoSessionOf } from '../../../session/persistence/mongo/mongo-unit-of-work';
import {
  AttemptRule,
  CODE_CLAIM,
  CODE_ROTATION,
  CodeClaim,
  CodeRotation,
  LEGACY_BLOCKER,
  LegacyBlocker,
  PENDING_REGISTRATION_CONSTRAINT,
  PendingCodeGeneration,
  PendingRegistrationKey,
  PendingRegistrationStore,
  RegistrationCodeClaim,
  ReservedRegistrationAttempt,
} from '../../pending-codes/pending-registration.store';
import {
  PendingRegistration,
  PendingRegistrationDocument,
} from './schemas/pending-registration.schema';
import {
  buildGenerationPipeline,
  buildRefreshFilter,
  buildReplaceFilter,
} from './mongo-pending-refresh';
import {
  insertOrConflict,
  singleStatement,
} from '../../../common/persistence/mongo/mongo-unique-conflict';

const PENDING_REGISTRATION_INDEX_CONSTRAINTS = {
  email_1_purpose_1: PENDING_REGISTRATION_CONSTRAINT.ADDRESS_PURPOSE,
} as const;

function boundUser(
  generation: PendingCodeGeneration,
): Types.ObjectId | undefined {
  return generation.userId === undefined
    ? undefined
    : toObjectId(generation.userId);
}

function generationFence(
  purpose: PendingRegistrationKey['purpose'],
  generation: PendingCodeGeneration,
): Record<string, unknown> {
  if (
    purpose !== PENDING_PURPOSE.EMAIL_CHANGE ||
    generation.userId === undefined ||
    generation.addressGeneration === undefined
  ) {
    return {};
  }

  const userId = toObjectId(generation.userId);
  return {
    $or: [
      { userId: { $ne: userId } },
      { userId, addressGeneration: { $lte: generation.addressGeneration } },
    ],
  };
}

@Injectable()
export class MongoPendingRegistrationStore extends PendingRegistrationStore {
  constructor(
    @InjectModel(PendingRegistration.name)
    private readonly pendingRegistrationModel: Model<PendingRegistrationDocument>,
  ) {
    super();
  }

  async rotateLiveCode(
    key: PendingRegistrationKey,
    now: Date,
    generation: PendingCodeGeneration,
  ): Promise<CodeRotation> {
    const refreshed = await singleStatement(() =>
      this.pendingRegistrationModel.findOneAndUpdate(
        {
          ...buildRefreshFilter(key.email, key.purpose, now),
          ...generationFence(key.purpose, generation),
        },
        buildGenerationPipeline(generation, boundUser(generation)),
        { new: true, select: '_id' },
      ),
    );
    return refreshed ? CODE_ROTATION.ROTATED : CODE_ROTATION.NO_MATCHING_RECORD;
  }

  async replaceExpiredCode(
    key: PendingRegistrationKey,
    now: Date,
    generation: PendingCodeGeneration,
  ): Promise<CodeRotation> {
    const replaced = await singleStatement(() =>
      this.pendingRegistrationModel.findOneAndUpdate(
        {
          ...buildReplaceFilter(key.email, key.purpose, now),
          ...generationFence(key.purpose, generation),
        },
        buildGenerationPipeline(generation, boundUser(generation)),
        { new: true, select: '_id' },
      ),
    );
    return replaced ? CODE_ROTATION.ROTATED : CODE_ROTATION.NO_MATCHING_RECORD;
  }

  async hasRecord(key: PendingRegistrationKey): Promise<boolean> {
    const existing = await singleStatement(() =>
      this.pendingRegistrationModel.exists({
        email: { $eq: key.email },
        purpose: key.purpose,
      }),
    );
    return existing !== null;
  }

  async dropExpiredRecord(
    key: PendingRegistrationKey,
    now: Date,
  ): Promise<void> {
    await singleStatement(() =>
      this.pendingRegistrationModel.deleteOne({
        email: { $eq: key.email },
        purpose: key.purpose,
        expiresAt: { $lte: now },
      }),
    );
  }

  async insertRecord(
    key: PendingRegistrationKey,
    generation: PendingCodeGeneration,
  ): Promise<void> {
    const userId = boundUser(generation);
    await insertOrConflict(PENDING_REGISTRATION_INDEX_CONSTRAINTS, () =>
      this.pendingRegistrationModel.create({
        email: key.email,
        purpose: key.purpose,
        hashedCode: generation.hashedCode,
        attempts: 0,
        expiresAt: generation.expiresAt,
        userId,
        addressGeneration: generation.addressGeneration,
      }),
    );
  }

  /**
   * Under the old unique email index a record without a purpose can block the
   * insert. An old sign-up (it carries a password hash) is dropped. An old
   * address confirmation is left for the migration to convert.
   */
  async clearLegacyBlocker(email: string): Promise<LegacyBlocker> {
    const deleted = await singleStatement(() =>
      this.pendingRegistrationModel.deleteOne({
        email: { $eq: email },
        purpose: { $exists: false },
        hashedPassword: { $exists: true },
      }),
    );
    if (deleted.deletedCount > 0) {
      return LEGACY_BLOCKER.CLEARED;
    }

    const legacyConfirmation = await singleStatement(() =>
      this.pendingRegistrationModel.exists({
        email: { $eq: email },
        purpose: { $exists: false },
        hashedPassword: { $exists: false },
      }),
    );
    return legacyConfirmation
      ? LEGACY_BLOCKER.CONFIRMATION_KEPT
      : LEGACY_BLOCKER.CLEARED;
  }

  async reserveAttempt(
    key: PendingRegistrationKey,
    rule: AttemptRule,
  ): Promise<ReservedRegistrationAttempt | null> {
    const reserved = await singleStatement(() =>
      this.pendingRegistrationModel.findOneAndUpdate(
        {
          email: { $eq: key.email },
          purpose: key.purpose,
          expiresAt: { $gt: rule.now },
          attempts: { $lt: rule.maxAttempts },
        },
        { $inc: { attempts: 1 } },
        { new: true, select: '+hashedCode' },
      ),
    );
    if (!reserved) {
      return null;
    }
    return {
      id: reserved._id.toString(),
      email: reserved.email,
      hashedCode: reserved.hashedCode,
      userId: reserved.userId?.toString(),
      addressGeneration: reserved.addressGeneration,
    };
  }

  async claimCode(
    unitOfWork: UnitOfWork,
    claim: RegistrationCodeClaim,
  ): Promise<CodeClaim> {
    const consumed = await this.pendingRegistrationModel.findOneAndDelete(
      {
        _id: toObjectId(claim.id),
        purpose: claim.purpose,
        hashedCode: claim.hashedCode,
        expiresAt: { $gt: claim.now },
      },
      { session: mongoSessionOf(unitOfWork) },
    );
    return consumed !== null ? CODE_CLAIM.CLAIMED : CODE_CLAIM.NOT_CLAIMABLE;
  }

  async deleteExpiredBefore(cutoff: Date): Promise<number> {
    const deleted = await singleStatement(() =>
      this.pendingRegistrationModel.deleteMany({
        expiresAt: { $lte: cutoff },
      }),
    );
    return deleted.deletedCount;
  }
}
