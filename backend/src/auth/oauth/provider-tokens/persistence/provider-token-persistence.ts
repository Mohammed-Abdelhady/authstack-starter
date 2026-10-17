import type { Provider } from '@nestjs/common';
import { forStorage } from '../../../../common/persistence/storage-choice';
import { MONGO_PROVIDER_TOKEN_PROVIDERS } from './mongo/mongo-provider-token-persistence'; // feature:mongodb
import { POSTGRES_PROVIDER_TOKEN_PROVIDERS } from './postgres/postgres-provider-token-persistence'; // feature:postgres

/** What the provider token module runs on. The one place it names a database. */
export const PROVIDER_TOKEN_PERSISTENCE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => MONGO_PROVIDER_TOKEN_PROVIDERS, // feature:mongodb
  postgres: () => POSTGRES_PROVIDER_TOKEN_PROVIDERS, // feature:postgres
});
