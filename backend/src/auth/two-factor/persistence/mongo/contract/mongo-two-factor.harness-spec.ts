import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { createConnection, Types } from 'mongoose';
import {
  FrozenClock,
  TEST_NOW,
} from '../../../../../../test/utils/frozen-clock';
import { startMemoryReplSet } from '../../../../../../test/utils/memory-replset';
import { USER_HIDDEN_FIELDS } from '../../../../../user/constants/user.constants';
import { toStoredAccount } from '../../../../../user/persistence/mongo/mongo-account-records';
import {
  User,
  UserSchema,
} from '../../../../../user/persistence/mongo/schemas/user.schema';
import { MongoSecondFactorChallengeStore } from '../mongo-second-factor-challenge.store';
import { MongoSecondFactorStore } from '../mongo-second-factor.store';
import {
  TwoFactorChallenge,
  TwoFactorChallengeSchema,
} from '../schemas/two-factor-challenge.schema';
import { SecondFactorChallengeStore } from '../../../stores/second-factor-challenge.store';
import { SecondFactorStore } from '../../../stores/second-factor.store';
import { TwoFactorContractHarness } from '../../../contract/two-factor-contract.harness-spec';

const A_UUID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e5f';

export interface MongoTwoFactorHarness extends TwoFactorContractHarness {
  setRawSessionVersion(
    userId: string,
    version: number | null | undefined,
  ): Promise<void>;
  mappedSessionVersion(userId: string): Promise<number>;
}

export async function bootMongoTwoFactorHarness(): Promise<MongoTwoFactorHarness> {
  const mongo = await startMemoryReplSet();
  const connection = await createConnection(
    mongo.uri('two_factor_contract'),
  ).asPromise();
  const users = connection.model(User.name, UserSchema);
  const challenges = connection.model(
    TwoFactorChallenge.name,
    TwoFactorChallengeSchema,
  );
  await users.init();
  await challenges.init();
  // Built the way the application builds them: each adapter over its model.
  const module = await Test.createTestingModule({
    providers: [
      { provide: SecondFactorStore, useClass: MongoSecondFactorStore },
      {
        provide: SecondFactorChallengeStore,
        useClass: MongoSecondFactorChallengeStore,
      },
      { provide: getModelToken(User.name), useValue: users },
      { provide: getModelToken(TwoFactorChallenge.name), useValue: challenges },
    ],
  }).compile();

  return {
    clock: new FrozenClock(TEST_NOW),
    accounts: module.get(SecondFactorStore),
    challenges: module.get(SecondFactorChallengeStore),
    setRawSessionVersion: async (userId, version) => {
      const id = new Types.ObjectId(userId);
      await users.updateOne(
        { _id: id },
        version === undefined
          ? { $unset: { sessionVersion: 1 } }
          : { $set: { sessionVersion: version } },
      );
    },
    mappedSessionVersion: async (userId) => {
      const user = await users
        .findById(userId)
        .select(USER_HIDDEN_FIELDS)
        .exec();
      if (!user) throw new Error('seed account missing');
      return toStoredAccount(user).sessionVersion;
    },

    // The profile store's own query and mapping, without its other models.
    profileSaysEnabled: async (userId) => {
      const user = await users
        .findById(userId)
        .select(USER_HIDDEN_FIELDS)
        .exec();
      return user !== null && toStoredAccount(user).twoFactorEnabled;
    },

    seedAccount: async (account) => {
      const created = await users.create({
        email: account.email,
        name: 'Contract Tester',
        password: account.passwordHash,
        isVerified: true,
        isDeleted: account.deleted ?? false,
      });
      return created._id.toString();
    },
    setDeleted: async (userId, deleted) => {
      await users.updateOne(
        { _id: new Types.ObjectId(userId) },
        { $set: { isDeleted: deleted } },
      );
    },
    removeAccount: async (userId) => {
      await users.deleteOne({ _id: new Types.ObjectId(userId) });
    },
    seedSecondFactor: async (userId, state) => {
      await users.updateOne(
        { _id: new Types.ObjectId(userId) },
        { $set: { twoFactor: state } },
      );
    },
    secondFactor: async (userId) => {
      const user = await users.findById(userId).lean().exec();
      const state = user?.twoFactor;
      return {
        enabled: state?.enabled === true,
        secret: state?.secret
          ? {
              ciphertext: state.secret.ciphertext,
              iv: state.secret.iv,
              tag: state.secret.tag,
            }
          : null,
        confirmedAt: state?.confirmedAt ?? null,
        recoveryCodes: (state?.recoveryCodes ?? []).map((code) => ({
          hash: code.hash,
          usedAt: code.usedAt ?? null,
        })),
        lastUsedStep: state?.lastUsedStep ?? null,
      };
    },

    seedFailures: async (userId, failures) => {
      await users.updateOne(
        { _id: new Types.ObjectId(userId) },
        {
          $set: {
            'twoFactor.failedAttempts': failures.failedAttempts,
            'twoFactor.lockedUntil': failures.lockedUntil,
          },
        },
      );
    },
    failures: async (userId) => {
      const user = await users.findById(userId).lean().exec();
      return {
        failedAttempts: user?.twoFactor?.failedAttempts ?? 0,
        lockedUntil: user?.twoFactor?.lockedUntil ?? null,
      };
    },

    seedChallenge: async (challenge) => {
      const created = await challenges.create({
        user: new Types.ObjectId(challenge.userId),
        nonceHash: challenge.nonceHash,
        attempts: challenge.attempts ?? 0,
        claimedAt: challenge.claimedAt ?? null,
        expiresAt: challenge.expiresAt,
      });
      return created._id.toString();
    },
    alterChallenge: async (challengeId, change) => {
      await challenges.updateOne(
        { _id: new Types.ObjectId(challengeId) },
        { $set: change },
      );
    },
    storedChallenges: async () => {
      const stored = await challenges
        .find({})
        .sort({ nonceHash: 1 })
        .lean()
        .exec();
      return stored.map((challenge) => ({
        id: challenge._id.toString(),
        userId: challenge.user.toString(),
        nonceHash: challenge.nonceHash,
        attempts: challenge.attempts,
        claimed: Boolean(challenge.claimedAt),
        expiresAt: challenge.expiresAt,
      }));
    },

    absentId: () => new Types.ObjectId().toString(),
    foreignId: () => A_UUID,

    reset: async () => {
      await challenges.deleteMany({});
      await users.deleteMany({});
    },
    close: async () => {
      await connection.close();
      await mongo.stop();
    },
  };
}
