import { DynamicModule, Provider } from '@nestjs/common';
import { forStorage } from '../../common/persistence/storage-choice';
// feature:mongodb:start
import {
  MONGO_ADMIN_MODELS,
  MONGO_ADMIN_PROVIDERS,
} from './mongo/mongo-admin-persistence';
// feature:mongodb:end
import { POSTGRES_ADMIN_PROVIDERS } from './postgres/postgres-admin-persistence'; // feature:postgres

/** What AdminModule runs on. The one place it names a database. */
export const ADMIN_PERSISTENCE_IMPORTS: DynamicModule[] = forStorage({
  mongodb: () => [MONGO_ADMIN_MODELS], // feature:mongodb
  postgres: () => [], // feature:postgres
});

export const ADMIN_PERSISTENCE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => MONGO_ADMIN_PROVIDERS, // feature:mongodb
  postgres: () => POSTGRES_ADMIN_PROVIDERS, // feature:postgres
});
