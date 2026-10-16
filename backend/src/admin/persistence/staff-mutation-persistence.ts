import type { DynamicModule, Provider } from '@nestjs/common';
import { forStorage } from '../../common/persistence/storage-choice';
import { StaffIdempotencyStore } from '../stores/staff-idempotency.store'; // feature:postgres
// feature:mongodb:start
import {
  MONGO_STAFF_MUTATION_MODELS,
  MONGO_STAFF_MUTATION_PROVIDERS,
} from './mongo/mongo-staff-mutation-persistence';
// feature:mongodb:end
import { PostgresStaffIdempotencyStore } from './postgres/postgres-staff-idempotency.store'; // feature:postgres

export const STAFF_MUTATION_PERSISTENCE_IMPORTS: DynamicModule[] = forStorage({
  mongodb: () => [MONGO_STAFF_MUTATION_MODELS], // feature:mongodb
  postgres: () => [], // feature:postgres
});

export const STAFF_MUTATION_PERSISTENCE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => MONGO_STAFF_MUTATION_PROVIDERS, // feature:mongodb
  // feature:postgres:start
  postgres: () => [
    { provide: StaffIdempotencyStore, useClass: PostgresStaffIdempotencyStore },
  ],
  // feature:postgres:end
});
