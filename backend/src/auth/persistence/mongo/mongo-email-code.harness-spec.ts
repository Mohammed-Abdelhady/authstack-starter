import mongoose from 'mongoose';
import { MongoUnitOfWorkRunner } from '../../../session/persistence/mongo/mongo-unit-of-work';
import { startMemoryReplSet } from '../../../../test/utils/memory-replset';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import type { EmailCodeHarness } from '../../pending-codes/email-code.harness-spec';
import {
  EMAIL_CODE_COLLECTION,
  MongoEmailCodeStore,
} from './mongo-email-code.store';

export async function bootMongoEmailCodeHarness(): Promise<EmailCodeHarness> {
  const server = await startMemoryReplSet();
  const connection = await mongoose
    .createConnection(server.uri('email-codes'))
    .asPromise();
  const db = connection.db;
  if (!db) throw new Error('MongoDB connection has no database');
  const clock = new FrozenClock(TEST_NOW);
  const store = new MongoEmailCodeStore(db, clock);
  await store.ensureIndexes();
  return {
    store,
    clock,
    unitOfWork: new MongoUnitOfWorkRunner(connection),
    reset: async () => {
      await db.collection(EMAIL_CODE_COLLECTION).deleteMany({});
    },
    close: async () => {
      await connection.close();
      await server.stop();
    },
    checkSetup: async () => {
      const indexes = await db.collection(EMAIL_CODE_COLLECTION).indexes();
      expect(
        indexes.some(
          (index) =>
            index.name === 'email_code_owner_purpose_unique' &&
            index.unique === true,
        ),
      ).toBe(true);
      expect(
        indexes.some(
          (index) =>
            index.name === 'email_code_expiry' &&
            index.expireAfterSeconds === 0,
        ),
      ).toBe(true);
    },
  };
}
