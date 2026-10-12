import type { Provider } from '@nestjs/common';
import { forStorage } from '../../../common/persistence/storage-choice';
import { MONGO_NATIVE_ATTEMPT_PROVIDERS } from './mongo/mongo-native-attempt-persistence';
import { POSTGRES_NATIVE_ATTEMPT_PROVIDERS } from './postgres/postgres-native-attempt-persistence';

export const NATIVE_AUTH_PERSISTENCE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => MONGO_NATIVE_ATTEMPT_PROVIDERS,
  postgres: () => POSTGRES_NATIVE_ATTEMPT_PROVIDERS,
});
