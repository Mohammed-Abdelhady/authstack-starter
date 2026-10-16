import { createConnection } from 'mongoose';
import { MongoStaffIdempotencyStore } from '../../../src/admin/persistence/mongo/mongo-staff-idempotency.store';
import {
  StaffIdempotencyKey,
  StaffIdempotencyKeySchema,
  StaffIdempotencyKeyDocument,
} from '../../../src/admin/persistence/mongo/schemas/staff-idempotency-key.schema';
import { MongoUnitOfWorkRunner } from '../../../src/session/persistence/mongo/mongo-unit-of-work';
import { FrozenClock, TEST_NOW } from '../frozen-clock';
import { startMemoryReplSet } from '../memory-replset';
import { StaffIdempotencyHarness } from './staff-idempotency-harness';

export async function bootMongoStaffIdempotencyHarness(): Promise<StaffIdempotencyHarness> {
  const mongo = await startMemoryReplSet();
  const connection = createConnection(mongo.uri('staff_idempotency_contract'));
  const close = async (): Promise<void> => {
    try {
      await connection.close();
    } finally {
      await mongo.stop();
    }
  };
  try {
    await connection.asPromise();
    connection.model(StaffIdempotencyKey.name, StaffIdempotencyKeySchema);
    const keys = connection.model<StaffIdempotencyKeyDocument>(
      StaffIdempotencyKey.name,
    );
    await keys.init();
    return {
      store: new MongoStaffIdempotencyStore(keys),
      clock: new FrozenClock(TEST_NOW),
      runner: (pause) => new MongoUnitOfWorkRunner(connection, pause),
      records: async () => {
        const records = await keys.find({}).sort({ _id: 1 }).lean().exec();
        return records.map(({ requestHash, resourceId }) => ({
          requestHash,
          resourceId,
        }));
      },
      reset: async () => {
        await keys.deleteMany({}).exec();
      },
      close,
    };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}
