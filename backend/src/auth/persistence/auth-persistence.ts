import { DynamicModule, Provider, Type } from '@nestjs/common';
import { forStorage } from '../../common/persistence/storage-choice';
// feature:mongodb:start
import {
  MONGO_AUTH_BRIDGES,
  MONGO_AUTH_MODELS,
  MONGO_AUTH_PROVIDERS,
} from './mongo/mongo-auth-persistence';
// feature:mongodb:end
import { POSTGRES_AUTH_PROVIDERS } from './postgres/postgres-auth-persistence'; // feature:postgres

/** What AuthModule runs on. The one place it names a database. */
export const AUTH_PERSISTENCE_IMPORTS: DynamicModule[] = forStorage({
  mongodb: () => [MONGO_AUTH_MODELS], // feature:mongodb
  postgres: () => [], // feature:postgres
});

export const AUTH_PERSISTENCE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => MONGO_AUTH_PROVIDERS, // feature:mongodb
  postgres: () => POSTGRES_AUTH_PROVIDERS, // feature:postgres
});

/** What the adapter hands on to modules that import AuthModule. */
export const AUTH_PERSISTENCE_EXPORTS: Type[] = forStorage({
  mongodb: () => MONGO_AUTH_BRIDGES, // feature:mongodb
  postgres: () => [], // feature:postgres
});
