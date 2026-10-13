import type { Provider } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Clock } from '../../../../common/services/clock';
import { NativeAttemptStore } from '../../stores/native-attempt.store';
import { MongoNativeAttemptStore } from './mongo-native-attempt.store';

export const MONGO_NATIVE_ATTEMPT_PROVIDERS: Provider[] = [
  {
    provide: NativeAttemptStore,
    inject: [getConnectionToken(), Clock],
    useFactory: async (
      connection: Connection,
      clock: Clock,
    ): Promise<NativeAttemptStore> => {
      if (!connection.db) throw new Error('MongoDB connection is not ready');
      const store = new MongoNativeAttemptStore(connection.db, clock);
      await store.ensureIndexes();
      return store;
    },
  },
];
