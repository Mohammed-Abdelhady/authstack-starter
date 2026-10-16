import type { Provider } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Clock } from '../../../common/services/clock';
import { EmailCodeStore } from '../../pending-codes/email-code.store';
import { MongoEmailCodeStore } from './mongo-email-code.store';

export const MONGO_EMAIL_CODE_PROVIDERS: Provider[] = [
  {
    provide: EmailCodeStore,
    inject: [getConnectionToken(), Clock],
    useFactory: async (
      connection: Connection,
      clock: Clock,
    ): Promise<EmailCodeStore> => {
      if (!connection.db) throw new Error('MongoDB connection is not ready');
      const store = new MongoEmailCodeStore(connection.db, clock);
      await store.ensureIndexes();
      return store;
    },
  },
];
