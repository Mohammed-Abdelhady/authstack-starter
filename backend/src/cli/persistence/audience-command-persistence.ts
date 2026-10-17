import type { DynamicModule, Provider } from '@nestjs/common';
import { forStorage } from '../../common/persistence/storage-choice';
// feature:mongodb:start
import {
  MONGO_AUDIENCE_COMMAND_MODELS,
  MONGO_AUDIENCE_COMMAND_PROVIDERS,
} from './mongo/mongo-audience-command-persistence';
// feature:mongodb:end
import { POSTGRES_AUDIENCE_COMMAND_PROVIDERS } from './postgres/postgres-audience-command-persistence'; // feature:postgres

export const AUDIENCE_COMMAND_IMPORTS: DynamicModule[] = forStorage({
  mongodb: () => [MONGO_AUDIENCE_COMMAND_MODELS], // feature:mongodb
  postgres: () => [], // feature:postgres
});

export const AUDIENCE_COMMAND_PROVIDERS: Provider[] = forStorage({
  mongodb: () => MONGO_AUDIENCE_COMMAND_PROVIDERS, // feature:mongodb
  postgres: () => POSTGRES_AUDIENCE_COMMAND_PROVIDERS, // feature:postgres
});
