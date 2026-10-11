import { DynamicModule, Provider, Type } from '@nestjs/common';
import { forStorage } from '../../common/persistence/storage-choice';
// feature:mongodb:start
import {
  MONGO_SESSION_BRIDGES,
  MONGO_SESSION_MODELS,
  MONGO_SESSION_PROVIDERS,
} from './mongo/mongo-session-persistence';
// feature:mongodb:end
import { POSTGRES_SESSION_PROVIDERS } from './postgres/postgres-session-persistence'; // feature:postgres

/** What SessionModule runs on. The one place it names a database. */
export const SESSION_PERSISTENCE_IMPORTS: DynamicModule[] = forStorage({
  mongodb: () => [MONGO_SESSION_MODELS], // feature:mongodb
  postgres: () => [], // feature:postgres
});

export const SESSION_PERSISTENCE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => MONGO_SESSION_PROVIDERS, // feature:mongodb
  postgres: () => POSTGRES_SESSION_PROVIDERS, // feature:postgres
});

/** What the adapter hands on to modules that import SessionModule. */
export const SESSION_PERSISTENCE_EXPORTS: Array<DynamicModule | Type> =
  forStorage({
    mongodb: () => [MONGO_SESSION_MODELS, ...MONGO_SESSION_BRIDGES], // feature:mongodb
    postgres: () => [], // feature:postgres
  });
