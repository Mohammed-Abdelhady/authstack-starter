import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { createConnection, Types } from 'mongoose';
import {
  FrozenClock,
  TEST_NOW,
} from '../../../../../../test/utils/frozen-clock';
import { startMemoryReplSet } from '../../../../../../test/utils/memory-replset';
import { MongoIdFormat } from '../../../../../common/persistence/mongo/mongo-id-format';
import {
  Role,
  RoleSchema,
} from '../../../../../role/persistence/mongo/schemas/role.schema';
import { MongoUnitOfWorkRunner } from '../../../../../session/persistence/mongo/mongo-unit-of-work';
import { MongoAccountProfileStore } from '../../../../../user/persistence/mongo/mongo-account-profile.store';
import { MongoLinkedAccountStore } from '../../../../../user/persistence/mongo/mongo-linked-account.store'; // feature:oauth-core
import { MongoSignInMethodStore } from '../../../../../user/persistence/mongo/mongo-sign-in-method.store';
import {
  User,
  UserSchema,
} from '../../../../../user/persistence/mongo/schemas/user.schema';
import { LinkedAccountStore } from '../../../../../user/stores/linked-account.store'; // feature:oauth-core
import { SignInMethodStore } from '../../../../../user/stores/sign-in-method.store';
import { MongoPasskeyAccounts } from '../mongo-passkey-accounts';
import { MongoPasskeyChallengeStore } from '../mongo-passkey-challenge.store';
import { MongoPasskeyStore } from '../mongo-passkey.store';
import {
  PasskeyChallenge,
  PasskeyChallengeSchema,
} from '../schemas/passkey-challenge.schema';
import { Passkey, PasskeySchema } from '../schemas/passkey.schema';
import { PasskeyAccounts } from '../../../stores/passkey-accounts';
import { PasskeyChallengeStore } from '../../../stores/passkey-challenge.store';
import { PasskeyStore } from '../../../stores/passkey.store';
import {
  byCredentialId,
  PasskeysContractHarness,
} from '../../../contract/passkeys-contract.harness-spec';

const A_UUID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e5f';

export async function bootMongoPasskeysHarness(): Promise<PasskeysContractHarness> {
  const mongo = await startMemoryReplSet();
  const connection = await createConnection(
    mongo.uri('passkeys_contract'),
  ).asPromise();
  const users = connection.model(User.name, UserSchema);
  const roles = connection.model(Role.name, RoleSchema);
  const passkeys = connection.model(Passkey.name, PasskeySchema);
  const challenges = connection.model(
    PasskeyChallenge.name,
    PasskeyChallengeSchema,
  );
  await Promise.all([
    users.init(),
    roles.init(),
    passkeys.init(),
    challenges.init(),
  ]);
  // Built the way the application builds them: each adapter over its model.
  const module = await Test.createTestingModule({
    providers: [
      { provide: PasskeyStore, useClass: MongoPasskeyStore },
      { provide: PasskeyChallengeStore, useClass: MongoPasskeyChallengeStore },
      { provide: PasskeyAccounts, useClass: MongoPasskeyAccounts },
      MongoAccountProfileStore,
      { provide: LinkedAccountStore, useClass: MongoLinkedAccountStore }, // feature:oauth-core
      { provide: SignInMethodStore, useClass: MongoSignInMethodStore },
      { provide: getModelToken(User.name), useValue: users },
      { provide: getModelToken(Role.name), useValue: roles },
      { provide: getModelToken(Passkey.name), useValue: passkeys },
      { provide: getModelToken(PasskeyChallenge.name), useValue: challenges },
    ],
  }).compile();
  const profiles = module.get(MongoAccountProfileStore);

  return {
    clock: new FrozenClock(TEST_NOW),
    passkeys: module.get(PasskeyStore),
    challenges: module.get(PasskeyChallengeStore),
    accounts: module.get(PasskeyAccounts),
    links: module.get(LinkedAccountStore), // feature:oauth-core
    signInMethods: module.get(SignInMethodStore),
    runner: (pause) => new MongoUnitOfWorkRunner(connection, pause),

    profilePasskeyCount: (userId) => profiles.countPasskeys(userId),

    seedAccount: async (account) => {
      const created = await users.create({
        email: account.email,
        name: 'Contract Tester',
        password: account.passwordHash,
        isVerified: true,
        linkedAccounts: account.linked
          ? [
              {
                provider: 'google',
                providerId: `google-${account.email}`,
                linkedAt: TEST_NOW,
              },
            ]
          : [],
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
    storedProviders: async (userId) => {
      const user = await users.findById(userId).lean().exec();
      return (user?.linkedAccounts ?? []).map((linked) => linked.provider);
    },

    seedPasskey: async (passkey) => {
      const created = await passkeys.create({
        user: new Types.ObjectId(passkey.userId),
        credentialId: passkey.credentialId,
        publicKey: Buffer.from([7, 7, 7]),
        counter: passkey.counter ?? 0,
        transports: ['internal'],
        deviceType: 'singleDevice',
        backedUp: false,
        name: passkey.name ?? 'Seeded key',
        lastUsedAt: null,
        createdAt: passkey.createdAt,
      });
      return created._id.toString();
    },
    storedPasskeys: async () => {
      const stored = await passkeys.find({}).exec();
      return stored
        .map((passkey) => ({
          id: passkey._id.toString(),
          userId: passkey.user.toString(),
          credentialId: passkey.credentialId,
          publicKey: Buffer.from(passkey.publicKey),
          counter: passkey.counter,
          transports: passkey.transports,
          deviceType: passkey.deviceType ?? null,
          backedUp: passkey.backedUp,
          name: passkey.name,
          lastUsedAt: passkey.lastUsedAt ?? null,
        }))
        .sort(byCredentialId);
    },

    seedChallenge: async (challenge) => {
      await challenges.create(challenge);
    },
    setChallengeExpiry: async (challengeHash, expiresAt) => {
      await challenges.updateOne({ challengeHash }, { $set: { expiresAt } });
    },
    storedChallenges: async () => {
      const stored = await challenges
        .find({})
        .sort({ challengeHash: 1 })
        .lean()
        .exec();
      return stored.map((challenge) => ({
        challengeHash: challenge.challengeHash,
        purpose: challenge.purpose,
        userId: challenge.user ? challenge.user.toString() : null,
        expiresAt: challenge.expiresAt,
      }));
    },

    ids: new MongoIdFormat(),
    absentId: () => new Types.ObjectId().toString(),
    foreignId: () => A_UUID,

    reset: async () => {
      await challenges.deleteMany({});
      await passkeys.deleteMany({});
      await users.deleteMany({});
    },
    close: async () => {
      await connection.close();
      await mongo.stop();
    },
  };
}
