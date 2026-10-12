import { DynamicModule, Provider } from '@nestjs/common';
import { forStorage } from '../../common/persistence/storage-choice';
// feature:mongodb:start
import {
  MONGO_USER_MODELS,
  MONGO_USER_PROVIDERS,
} from './mongo/mongo-user-persistence';
// feature:mongodb:end
import { POSTGRES_USER_PROVIDERS } from './postgres/postgres-user-persistence'; // feature:postgres

/** What UserModule runs on. The one place it names a database. */
export const USER_PERSISTENCE_IMPORTS: DynamicModule[] = forStorage({
  mongodb: () => [MONGO_USER_MODELS], // feature:mongodb
  postgres: () => [], // feature:postgres
});

export const USER_PERSISTENCE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => MONGO_USER_PROVIDERS, // feature:mongodb
  postgres: () => POSTGRES_USER_PROVIDERS, // feature:postgres
});
