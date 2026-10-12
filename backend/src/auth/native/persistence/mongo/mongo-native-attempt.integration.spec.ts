import mongoose from 'mongoose';
import { startMemoryReplSet } from '../../../../../test/utils/memory-replset';
import { FrozenClock, TEST_NOW } from '../../../../../test/utils/frozen-clock';
import { MongoUnitOfWorkRunner } from '../../../../session/persistence/mongo/mongo-unit-of-work';
import { describeNativeAttemptContract } from '../native-attempt.harness-spec';
import { MongoNativeAttemptStore } from './mongo-native-attempt.store';

describeNativeAttemptContract('MongoDB', async () => {
  const server = await startMemoryReplSet();
  const connection = await mongoose
    .createConnection(server.uri('native-attempts'))
    .asPromise();
  const db = connection.db;
  if (!db) throw new Error('MongoDB connection has no database');
  const clock = new FrozenClock(TEST_NOW);
  const store = new MongoNativeAttemptStore(db, clock);
  await store.ensureIndexes();
  return {
    store,
    clock,
    unitOfWork: new MongoUnitOfWorkRunner(connection),
    reset: async () => {
      await db.collection('native_attempts').deleteMany({});
    },
    close: async () => {
      await connection.close();
      await server.stop();
    },
    checkSetup: async () => {
      const indexes = await db.collection('native_attempts').indexes();
      expect(
        indexes.some(
          (index) =>
            index.name === 'native_attempt_id_unique' && index.unique === true,
        ),
      ).toBe(true);
      expect(
        indexes.some(
          (index) =>
            index.name === 'native_attempt_expiry' &&
            index.expireAfterSeconds === 0,
        ),
      ).toBe(true);
    },
  };
});
