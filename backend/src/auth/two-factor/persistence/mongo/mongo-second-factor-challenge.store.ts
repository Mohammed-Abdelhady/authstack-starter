import type { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { mongoSessionOf } from '../../../../session/persistence/mongo/mongo-unit-of-work';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MalformedIdError } from '../../../../common/persistence/persistence-errors';
import {
  insertOrConflict,
  singleStatement,
} from '../../../../common/persistence/mongo/mongo-unique-conflict';
import {
  TwoFactorChallenge,
  TwoFactorChallengeDocument,
} from './schemas/two-factor-challenge.schema';
import {
  ChallengeClaimLimits,
  NewSecondFactorChallenge,
  SECOND_FACTOR_CHALLENGE_CONSTRAINT,
  SecondFactorChallengeKey,
  SecondFactorChallengeStore,
  StoredSecondFactorChallenge,
} from '../../stores/second-factor-challenge.store';

/** Index names of the collection to the rules' shared names. */
const CHALLENGE_CONSTRAINTS: Readonly<Record<string, string>> = {
  nonceHash_1: SECOND_FACTOR_CHALLENGE_CONSTRAINT.NONCE,
};

interface ChallengeFields {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  attempts: number;
  expiresAt: Date;
}

function toStoredChallenge(
  challenge: ChallengeFields,
): StoredSecondFactorChallenge {
  return {
    id: challenge._id.toString(),
    userId: challenge.user.toString(),
    attempts: challenge.attempts,
    expiresAt: challenge.expiresAt,
  };
}

function toObjectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) {
    throw new MalformedIdError();
  }
  return new Types.ObjectId(id);
}

/**
 * One document per challenge. A TTL index also clears lapsed ones, which is
 * housekeeping: every use compares the expiry itself.
 */
@Injectable()
export class MongoSecondFactorChallengeStore extends SecondFactorChallengeStore {
  constructor(
    @InjectModel(TwoFactorChallenge.name)
    private readonly challengeModel: Model<TwoFactorChallengeDocument>,
  ) {
    super();
  }

  isAccountId(id: string): boolean {
    return Types.ObjectId.isValid(id);
  }

  async open(challenge: NewSecondFactorChallenge): Promise<void> {
    const user = toObjectId(challenge.userId);
    await insertOrConflict(CHALLENGE_CONSTRAINTS, () =>
      this.challengeModel.create({
        user,
        nonceHash: challenge.nonceHash,
        attempts: 0,
        claimedAt: null,
        expiresAt: challenge.expiresAt,
      }),
    );
  }

  async openIn(
    work: UnitOfWork,
    challenge: NewSecondFactorChallenge,
  ): Promise<void> {
    await this.challengeModel.create(
      [
        {
          user: toObjectId(challenge.userId),
          nonceHash: challenge.nonceHash,
          attempts: 0,
          claimedAt: null,
          expiresAt: challenge.expiresAt,
        },
      ],
      { session: mongoSessionOf(work) },
    );
  }

  async find(
    key: SecondFactorChallengeKey,
  ): Promise<StoredSecondFactorChallenge | null> {
    const user = toObjectId(key.userId);
    const challenge = await singleStatement(() =>
      this.challengeModel.findOne({ nonceHash: key.nonceHash, user }),
    );
    return challenge ? toStoredChallenge(challenge) : null;
  }

  async claim(
    key: SecondFactorChallengeKey,
    limits: ChallengeClaimLimits,
  ): Promise<StoredSecondFactorChallenge | null> {
    const user = toObjectId(key.userId);
    const challenge = await singleStatement(() =>
      this.challengeModel.findOneAndUpdate(
        {
          nonceHash: key.nonceHash,
          user,
          expiresAt: { $gt: limits.now },
          attempts: { $lt: limits.maxAttempts },
          $or: [{ claimedAt: null }, { claimedAt: { $exists: false } }],
        },
        { $set: { claimedAt: limits.now } },
        { new: true },
      ),
    );
    return challenge ? toStoredChallenge(challenge) : null;
  }

  async countFailure(
    challengeId: string,
  ): Promise<{ attempts: number } | null> {
    const id = toObjectId(challengeId);
    const challenge = await singleStatement(() =>
      this.challengeModel.findOneAndUpdate(
        { _id: id },
        { $inc: { attempts: 1 }, $unset: { claimedAt: 1 } },
        { new: true },
      ),
    );
    return challenge ? { attempts: challenge.attempts } : null;
  }

  async discard(challengeId: string): Promise<void> {
    const id = toObjectId(challengeId);
    await singleStatement(() => this.challengeModel.deleteOne({ _id: id }));
  }
}
