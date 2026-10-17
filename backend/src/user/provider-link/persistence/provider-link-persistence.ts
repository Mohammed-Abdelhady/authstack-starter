import type { Provider } from '@nestjs/common';
import { forStorage } from '../../../common/persistence/storage-choice';
import { MONGO_PROVIDER_LINK_PROVIDERS } from './mongo/mongo-provider-link-persistence'; // feature:mongodb
import { POSTGRES_PROVIDER_LINK_PROVIDERS } from './postgres/postgres-provider-link-persistence'; // feature:postgres

/** What linking from an app runs on. The one place it names a database. */
export const PROVIDER_LINK_PERSISTENCE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => MONGO_PROVIDER_LINK_PROVIDERS, // feature:mongodb
  postgres: () => POSTGRES_PROVIDER_LINK_PROVIDERS, // feature:postgres
});
