import { DynamicModule, Provider, Type } from '@nestjs/common';
import { MONGO_COMMON_PROVIDERS } from './mongo/mongo-common-persistence'; // feature:mongodb
import { MONGO_CONNECTION } from './mongo/mongo-connection'; // feature:mongodb
// feature:postgres:start
import {
  POSTGRES_COMMON_PROVIDERS,
  POSTGRES_CONNECTION,
} from './postgres/postgres-common-persistence';
// feature:postgres:end
import { forStorage } from './storage-choice';

/**
 * The database the application runs on. This file and its siblings named
 * `*-persistence.ts` are the only places outside an adapter folder that name
 * one: each hands its module the chosen adapter's modules and providers under
 * names that say nothing about a database.
 */
// feature:database-choice:start
// The choice is the validated `DATABASE_TYPE` setting, read once when the file
// is loaded.
// feature:database-choice:end
export const STORAGE_CONNECTION_IMPORTS: Array<DynamicModule | Type> =
  forStorage<Array<DynamicModule | Type>>({
    mongodb: () => [MONGO_CONNECTION], // feature:mongodb
    postgres: () => [POSTGRES_CONNECTION], // feature:postgres
  });

export const COMMON_PERSISTENCE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => MONGO_COMMON_PROVIDERS, // feature:mongodb
  postgres: () => POSTGRES_COMMON_PROVIDERS, // feature:postgres
});
