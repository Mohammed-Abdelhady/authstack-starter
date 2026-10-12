import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { createConnection, Types } from 'mongoose';
import { MailCounterStore } from '../../../../src/auth/pending-codes/mail-counter.store';
import { PasswordResetCodeStore } from '../../../../src/auth/pending-codes/password-reset-code.store';
import { PendingRegistrationStore } from '../../../../src/auth/pending-codes/pending-registration.store';
import { MONGO_PENDING_CODE_STORES } from '../../../../src/auth/persistence/mongo/mongo-pending-code-stores';
import {
  MailCounter,
  MailCounterSchema,
} from '../../../../src/auth/persistence/mongo/schemas/mail-counter.schema';
import {
  PendingPasswordReset,
  PendingPasswordResetSchema,
} from '../../../../src/auth/persistence/mongo/schemas/pending-password-reset.schema';
import {
  PendingRegistration,
  PendingRegistrationSchema,
} from '../../../../src/auth/persistence/mongo/schemas/pending-registration.schema';
import { MongoUnitOfWorkRunner } from '../../../../src/session/persistence/mongo/mongo-unit-of-work';
import { FrozenClock, TEST_NOW } from '../../frozen-clock';
import { startMemoryReplSet } from '../../memory-replset';
import { PendingCodesContractHarness } from './pending-codes-contract-harness';

const A_UUID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e5f';

export async function bootMongoPendingCodesHarness(): Promise<PendingCodesContractHarness> {
  const mongo = await startMemoryReplSet();
  const connection = await createConnection(
    mongo.uri('pending_codes_contract'),
  ).asPromise();
  const counters = connection.model(MailCounter.name, MailCounterSchema);
  const registrations = connection.model(
    PendingRegistration.name,
    PendingRegistrationSchema,
  );
  const resets = connection.model(
    PendingPasswordReset.name,
    PendingPasswordResetSchema,
  );
  await counters.init();
  await registrations.init();
  await resets.init();
  // Built the way the application builds them: each adapter over its model.
  const module = await Test.createTestingModule({
    providers: [
      ...MONGO_PENDING_CODE_STORES,
      { provide: getModelToken(MailCounter.name), useValue: counters },
      {
        provide: getModelToken(PendingRegistration.name),
        useValue: registrations,
      },
      { provide: getModelToken(PendingPasswordReset.name), useValue: resets },
    ],
  }).compile();
  const clock = new FrozenClock(TEST_NOW);

  return {
    clock,
    stores: {
      mailCounters: module.get(MailCounterStore),
      registrations: module.get(PendingRegistrationStore),
      passwordResets: module.get(PasswordResetCodeStore),
    },
    runner: (pause) => new MongoUnitOfWorkRunner(connection, pause),

    seedCounter: async (counter) => {
      await counters.create(counter);
    },
    counter: async (email, purpose) => {
      const stored = await counters.findOne({ email, purpose }).lean().exec();
      return stored
        ? {
            email: stored.email,
            purpose: stored.purpose,
            mailedCodes: stored.mailedCodes,
            windowStartedAt: stored.windowStartedAt,
            expiresAt: stored.expiresAt,
          }
        : null;
    },
    counterCount: () => counters.countDocuments({}).exec(),

    seedRegistration: async (record) => {
      const created = await registrations.create({
        ...record,
        userId: record.userId ? new Types.ObjectId(record.userId) : undefined,
      });
      return created._id.toString();
    },
    registration: async (email, purpose) => {
      const stored = await registrations
        .findOne({ email, purpose })
        .select('+hashedCode')
        .lean()
        .exec();
      return stored
        ? {
            id: stored._id.toString(),
            email: stored.email,
            purpose: stored.purpose,
            hashedCode: stored.hashedCode,
            attempts: stored.attempts,
            expiresAt: stored.expiresAt,
            userId: stored.userId?.toString() ?? null,
            addressGeneration: stored.addressGeneration ?? null,
          }
        : null;
    },
    registrationCount: () => registrations.countDocuments({}).exec(),

    seedPasswordReset: async (record) => {
      const created = await resets.create(record);
      return created._id.toString();
    },
    passwordReset: async (email) => {
      const stored = await resets
        .findOne({ email })
        .select('+hashedCode')
        .lean()
        .exec();
      return stored
        ? {
            id: stored._id.toString(),
            email: stored.email,
            hashedCode: stored.hashedCode,
            attempts: stored.attempts,
            expiresAt: stored.expiresAt,
          }
        : null;
    },
    passwordResetCount: () => resets.countDocuments({}).exec(),

    accountId: () => new Types.ObjectId().toString(),
    foreignId: () => A_UUID,

    reset: async () => {
      await counters.deleteMany({});
      await registrations.deleteMany({});
      await resets.deleteMany({});
    },
    close: async () => {
      await connection.close();
      await mongo.stop();
    },
  };
}
