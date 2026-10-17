import type { Provider } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { ProviderTokenStore } from '../../stores/provider-token.store';
import { MongoProviderTokenStore } from './mongo-provider-token.store';

export const MONGO_PROVIDER_TOKEN_PROVIDERS: Provider[] = [
  {
    provide: ProviderTokenStore,
    inject: [getConnectionToken()],
    useFactory: async (connection: Connection): Promise<ProviderTokenStore> => {
      if (!connection.db) throw new Error('MongoDB connection is not ready');
      const store = new MongoProviderTokenStore(connection.db);
      await store.ensureIndexes();
      return store;
    },
  },
];
