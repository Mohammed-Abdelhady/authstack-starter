import type { Provider } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { ErasureJobStore } from '../../stores/erasure-job.store';
import { AccountDeletionStore } from '../../stores/account-deletion.store';
import { AccountEraser } from '../../stores/account-eraser';
import { MongoErasureJobStore } from './mongo-erasure-job.store';
import { MongoAccountDeletionStore } from './mongo-account-deletion.store';
import { MongoAccountEraser } from './mongo-account-eraser';

export const MONGO_ERASURE_PROVIDERS: Provider[] = [
  {
    provide: ErasureJobStore,
    inject: [getConnectionToken()],
    useFactory: async (connection: Connection): Promise<ErasureJobStore> => {
      if (!connection.db) throw new Error('MongoDB connection is not ready');
      const store = new MongoErasureJobStore(connection.db);
      await store.ensureIndexes();
      return store;
    },
  },
  {
    provide: AccountDeletionStore,
    inject: [getConnectionToken()],
    useFactory: async (
      connection: Connection,
    ): Promise<AccountDeletionStore> => {
      if (!connection.db) throw new Error('MongoDB connection is not ready');
      const store = new MongoAccountDeletionStore(connection.db);
      await store.ensureIndexes();
      return store;
    },
  },
  {
    provide: AccountEraser,
    inject: [getConnectionToken()],
    useFactory: (connection: Connection): AccountEraser => {
      if (!connection.db) throw new Error('MongoDB connection is not ready');
      return new MongoAccountEraser(connection.db);
    },
  },
];
