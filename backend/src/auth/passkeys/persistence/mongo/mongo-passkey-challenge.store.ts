import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  insertOrConflict,
  singleStatement,
} from '../../../../common/persistence/mongo/mongo-unique-conflict';
import {
  PasskeyChallenge,
  PasskeyChallengeDocument,
} from './schemas/passkey-challenge.schema';
import {
  CHALLENGE_USE,
  ChallengeUse,
  NewPasskeyChallenge,
  PASSKEY_CHALLENGE_CONSTRAINT,
  PasskeyChallengeKey,
  PasskeyChallengeStore,
} from '../../stores/passkey-challenge.store';

/** Index names of the collection to the rules' shared names. */
const CHALLENGE_CONSTRAINTS: Readonly<Record<string, string>> = {
  challengeHash_1: PASSKEY_CHALLENGE_CONSTRAINT.CHALLENGE,
};

/**
 * One document per challenge. A TTL index also clears lapsed ones, which is
 * housekeeping: every use compares the expiry itself.
 */
@Injectable()
export class MongoPasskeyChallengeStore extends PasskeyChallengeStore {
  constructor(
    @InjectModel(PasskeyChallenge.name)
    private readonly challengeModel: Model<PasskeyChallengeDocument>,
  ) {
    super();
  }

  async open(challenge: NewPasskeyChallenge): Promise<void> {
    const { userId } = challenge;
    await insertOrConflict(CHALLENGE_CONSTRAINTS, () =>
      this.challengeModel.create({
        challengeHash: challenge.challengeHash,
        purpose: challenge.purpose,
        user:
          userId && Types.ObjectId.isValid(userId)
            ? new Types.ObjectId(userId)
            : undefined,
        expiresAt: challenge.expiresAt,
      }),
    );
  }

  async consume(key: PasskeyChallengeKey, now: Date): Promise<ChallengeUse> {
    const deleted = await singleStatement(() =>
      this.challengeModel.findOneAndDelete({
        challengeHash: key.challengeHash,
        purpose: key.purpose,
        expiresAt: { $gt: now },
      }),
    );
    return deleted ? CHALLENGE_USE.CONSUMED : CHALLENGE_USE.REFUSED;
  }
}
