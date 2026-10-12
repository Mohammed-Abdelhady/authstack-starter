import { DynamicModule, Provider } from '@nestjs/common';
import { forStorage } from '../../../common/persistence/storage-choice';
// feature:mongodb:start
import {
  MONGO_SEED_MODELS,
  MONGO_SEED_PROVIDERS,
} from './mongo/mongo-seed-persistence';
// feature:mongodb:end
import { POSTGRES_SEED_PROVIDERS } from './postgres/postgres-seed-persistence'; // feature:postgres

/** What SeedModule runs on. The one place it names a database. */
export const SEED_PERSISTENCE_IMPORTS: DynamicModule[] = forStorage({
  mongodb: () => [MONGO_SEED_MODELS], // feature:mongodb
  postgres: () => [], // feature:postgres
});

export const SEED_PERSISTENCE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => MONGO_SEED_PROVIDERS, // feature:mongodb
  postgres: () => POSTGRES_SEED_PROVIDERS, // feature:postgres
});
