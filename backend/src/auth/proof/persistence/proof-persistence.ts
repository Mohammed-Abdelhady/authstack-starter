import type { DynamicModule, Provider } from '@nestjs/common';
import { forStorage } from '../../../common/persistence/storage-choice';
// feature:mongodb:start
import {
  MONGO_PROOF_MODELS,
  MONGO_PROOF_PROVIDERS,
} from './mongo/mongo-proof-persistence';
// feature:mongodb:end
import { POSTGRES_PROOF_PROVIDERS } from './postgres/postgres-proof-persistence'; // feature:postgres

export const PROOF_PERSISTENCE_IMPORTS: DynamicModule[] = forStorage({
  mongodb: () => [MONGO_PROOF_MODELS], // feature:mongodb
  postgres: () => [], // feature:postgres
});

export const PROOF_PERSISTENCE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => MONGO_PROOF_PROVIDERS, // feature:mongodb
  postgres: () => POSTGRES_PROOF_PROVIDERS, // feature:postgres
});
