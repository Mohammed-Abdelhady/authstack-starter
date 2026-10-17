import type { Provider } from '@nestjs/common';
import { forStorage } from '../../../common/persistence/storage-choice';
import { MONGO_ERASURE_PROVIDERS } from './mongo/mongo-erasure-persistence'; // feature:mongodb
import { POSTGRES_ERASURE_PROVIDERS } from './postgres/postgres-erasure-persistence'; // feature:postgres

/** What the erasure module runs on. The one place it names a database. */
export const ERASURE_PERSISTENCE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => MONGO_ERASURE_PROVIDERS, // feature:mongodb
  postgres: () => POSTGRES_ERASURE_PROVIDERS, // feature:postgres
});
