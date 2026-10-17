import mongoose from 'mongoose';
import { FrozenClock, TEST_NOW } from '../../../../../test/utils/frozen-clock';
import { startMemoryReplSet } from '../../../../../test/utils/memory-replset';
import {
  MongoProviderLinkTicketStore,
  PROVIDER_LINK_TICKET_COLLECTION,
} from './mongo-provider-link-ticket.store';

export async function bootMongoProviderLinkHarness() {
  const server = await startMemoryReplSet();
  const connection = mongoose.createConnection(server.uri('provider-links'));
  try {
    await connection.asPromise();
    const db = connection.db;
    if (!db) throw new Error('MongoDB connection has no database');
    const store = new MongoProviderLinkTicketStore(db);
    await store.ensureIndexes();
    return {
      store,
      clock: new FrozenClock(TEST_NOW),
      userId: '000000000000000000000001',
      otherUserId: '000000000000000000000002',
      reset: async () => {
        await db.collection(PROVIDER_LINK_TICKET_COLLECTION).deleteMany({});
      },
      close: async () => {
        try {
          await connection.close();
        } finally {
          await server.stop();
        }
      },
      checkSetup: async () => {
        const indexes = await db
          .collection(PROVIDER_LINK_TICKET_COLLECTION)
          .indexes();
        expect(
          indexes.some(
            (index) =>
              index.name === 'provider_link_ticket_hash_unique' &&
              index.unique === true &&
              index.key.ticketHash === 1,
          ),
        ).toBe(true);
        expect(
          indexes.some(
            (index) =>
              index.name === 'provider_link_ticket_expires_at' &&
              index.expireAfterSeconds === 0 &&
              index.key.expiresAt === 1,
          ),
        ).toBe(true);
      },
    };
  } catch (error) {
    try {
      await connection.close();
    } finally {
      await server.stop();
    }
    throw error;
  }
}
