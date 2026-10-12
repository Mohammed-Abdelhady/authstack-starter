import { createConnection } from 'mongoose';
import { StoreHealthHarness } from '../../../../test/utils/health/store-health-contract';
import { startMemoryReplSet } from '../../../../test/utils/memory-replset';
import { MongoStoreHealth } from './mongo-store-health';

export async function bootMongoHealthHarness(): Promise<StoreHealthHarness> {
  const mongo = await startMemoryReplSet();
  const connection = await createConnection(
    mongo.uri('store_health_contract'),
  ).asPromise();

  return {
    health: new MongoStoreHealth(connection),
    // The driver watches the connection itself.
    observe: () => Promise.resolve(),
    cutOff: async () => {
      await connection.close();
    },
    readOnly: () => Promise.resolve(null),
    close: async () => {
      await connection.close();
      await mongo.stop();
    },
  };
}
