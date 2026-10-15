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
            index.name === 'email_code_purge_after' &&
            index.expireAfterSeconds === 0,
        ),
      ).toBe(true);
    },
    // The TTL monitor runs on the server's clock about once a minute, so the
    // case removes what it would, read from the collection's own TTL index.
    cleanUp: async () => {
      const codes = db.collection(EMAIL_CODE_COLLECTION);
      const ttl = (await codes.indexes()).find(
        (index) => index.expireAfterSeconds !== undefined,
      );
      const seconds = ttl?.expireAfterSeconds;
      const field = ttl ? Object.keys(ttl.key)[0] : undefined;
      if (seconds === undefined || field === undefined) {
        throw new Error('The email codes have no TTL index');
      }
      const cutoff = new Date(clock.now().getTime() - seconds * 1000);
      await codes.deleteMany({ [field]: { $lte: cutoff } });
    },
  };
}
