import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { toObjectId } from '../../../session/persistence/mongo/mongo-issuance-mappers';
import {
  PASSWORD_RESET_CONSTRAINT,
  PasswordResetClaim,
  PasswordResetCodeStore,
  PasswordResetGeneration,
  ReservedPasswordResetAttempt,
} from '../../pending-codes/password-reset-code.store';
import {
  AttemptRule,
  CODE_CLAIM,
  CODE_ROTATION,
  CodeClaim,
  CodeRotation,
} from '../../pending-codes/pending-registration.store';
import {
  PendingPasswordReset,
  PendingPasswordResetDocument,
} from './schemas/pending-password-reset.schema';
import {
  insertOrConflict,
  singleStatement,
} from '../../../common/persistence/mongo/mongo-unique-conflict';
import { MAIL_COUNTER_PURPOSE } from '../../constants/registration';
import {
  MailCounter,
  MailCounterDocument,
} from './schemas/mail-counter.schema';
import { clearMongoGuesses, reserveMongoGuess } from './mongo-code-guesses';

const PASSWORD_RESET_INDEX_CONSTRAINTS = {
  email_1: PASSWORD_RESET_CONSTRAINT.ADDRESS,
} as const;
const PURPOSE = MAIL_COUNTER_PURPOSE.PASSWORD_RESET;

@Injectable()
export class MongoPasswordResetCodeStore extends PasswordResetCodeStore {
  constructor(
    @InjectModel(PendingPasswordReset.name)
    private readonly pendingPasswordResetModel: Model<PendingPasswordResetDocument>,
    @InjectModel(MailCounter.name)
    private readonly mailCounterModel: Model<MailCounterDocument>,
  ) {
    super();
  }

  async rotateCode(
    email: string,
    generation: PasswordResetGeneration,
  ): Promise<CodeRotation> {
    const updated = await singleStatement(() =>
      this.pendingPasswordResetModel.updateOne(
        { email: { $eq: email } },
        {
          $set: {
            hashedCode: generation.hashedCode,
            attempts: 0,
            expiresAt: generation.expiresAt,
          },
        },
      ),
    );
    return updated.matchedCount > 0
      ? CODE_ROTATION.ROTATED
      : CODE_ROTATION.NO_MATCHING_RECORD;
  }

  async insertRecord(
    email: string,
    generation: PasswordResetGeneration,
  ): Promise<void> {
    await insertOrConflict(PASSWORD_RESET_INDEX_CONSTRAINTS, () =>
      this.pendingPasswordResetModel.create({
        email,
        hashedCode: generation.hashedCode,
        attempts: 0,
        expiresAt: generation.expiresAt,
      }),
    );
  }

  async reserveAttempt(
    email: string,
    rule: AttemptRule,
  ): Promise<ReservedPasswordResetAttempt | null> {
    const reserved = await singleStatement(() =>
      this.pendingPasswordResetModel.findOneAndUpdate(
        {
          email: { $eq: email },
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
    const counted = await reserveMongoGuess(
      this.mailCounterModel,
      { email, purpose: PURPOSE },
      rule.now,
      rule.guesses,
    );
    return counted
      ? { id: reserved._id.toString(), hashedCode: reserved.hashedCode }
      : null;
  }

  async claimCode(claim: PasswordResetClaim): Promise<CodeClaim> {
    const deleted = await singleStatement(() =>
      this.pendingPasswordResetModel.findOneAndDelete({
        _id: toObjectId(claim.id),
        hashedCode: claim.hashedCode,
        expiresAt: { $gt: claim.now },
      }),
    );
    if (deleted === null) {
      return CODE_CLAIM.NOT_CLAIMABLE;
    }
    await singleStatement(() =>
      clearMongoGuesses(this.mailCounterModel, {
        email: deleted.email,
        purpose: PURPOSE,
      }),
    );
    return CODE_CLAIM.CLAIMED;
  }

  async dropExpiredRecord(email: string, now: Date): Promise<void> {
    await singleStatement(() =>
      this.pendingPasswordResetModel.deleteOne({
        email: { $eq: email },
        expiresAt: { $lte: now },
      }),
    );
  }

  async deleteExpiredBefore(cutoff: Date): Promise<number> {
    const deleted = await singleStatement(() =>
      this.pendingPasswordResetModel.deleteMany({
        expiresAt: { $lte: cutoff },
      }),
    );
    return deleted.deletedCount;
  }
}
