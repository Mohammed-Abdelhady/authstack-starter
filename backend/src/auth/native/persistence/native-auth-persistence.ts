import type { Provider } from '@nestjs/common';
import { forStorage } from '../../../common/persistence/storage-choice';
import { MONGO_NATIVE_ATTEMPT_PROVIDERS } from './mongo/mongo-native-attempt-persistence'; // feature:mongodb
import { POSTGRES_NATIVE_ATTEMPT_PROVIDERS } from './postgres/postgres-native-attempt-persistence'; // feature:postgres

export const NATIVE_AUTH_PERSISTENCE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => MONGO_NATIVE_ATTEMPT_PROVIDERS, // feature:mongodb
  postgres: () => POSTGRES_NATIVE_ATTEMPT_PROVIDERS, // feature:postgres
});
