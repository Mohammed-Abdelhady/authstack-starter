import type { Provider } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { ProviderLinkTicketStore } from '../../stores/provider-link-ticket.store';
import { MongoProviderLinkTicketStore } from './mongo-provider-link-ticket.store';

export const MONGO_PROVIDER_LINK_PROVIDERS: Provider[] = [
  {
    provide: ProviderLinkTicketStore,
    inject: [getConnectionToken()],
    useFactory: async (
      connection: Connection,
    ): Promise<ProviderLinkTicketStore> => {
      if (!connection.db) throw new Error('MongoDB connection is not ready');
      const store = new MongoProviderLinkTicketStore(connection.db);
      await store.ensureIndexes();
      return store;
    },
  },
];
