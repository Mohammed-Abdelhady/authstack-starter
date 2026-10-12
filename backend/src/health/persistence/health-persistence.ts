import { Provider } from '@nestjs/common';
import { forStorage } from '../../common/persistence/storage-choice';
import { MONGO_STORE_HEALTH } from './mongo/mongo-store-health'; // feature:mongodb
import { POSTGRES_HEALTH_PROVIDERS } from './postgres/postgres-health-persistence'; // feature:postgres

/** What HealthModule runs on. The one place it names a database. */
export const HEALTH_PERSISTENCE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => [MONGO_STORE_HEALTH], // feature:mongodb
  postgres: () => POSTGRES_HEALTH_PROVIDERS, // feature:postgres
});
