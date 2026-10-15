import type { DynamicModule, Provider } from '@nestjs/common';
import { forStorage } from '../../common/persistence/storage-choice';
// feature:mongodb:start
import {
  MONGO_AUDIENCE_MAPPING_MODELS,
  MONGO_AUDIENCE_MAPPING_PROVIDERS,
} from './mongo/mongo-audience-mapping-persistence';
// feature:mongodb:end
import { POSTGRES_AUDIENCE_MAPPING_PROVIDERS } from './postgres/postgres-audience-mapping-persistence'; // feature:postgres

export const AUDIENCE_MAPPING_IMPORTS: DynamicModule[] = forStorage({
  mongodb: () => [MONGO_AUDIENCE_MAPPING_MODELS], // feature:mongodb
  postgres: () => [], // feature:postgres
});

export const AUDIENCE_MAPPING_PROVIDERS: Provider[] = forStorage({
  mongodb: () => MONGO_AUDIENCE_MAPPING_PROVIDERS, // feature:mongodb
  postgres: () => POSTGRES_AUDIENCE_MAPPING_PROVIDERS, // feature:postgres
});
