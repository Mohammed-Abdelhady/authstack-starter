import { DynamicModule, Provider } from '@nestjs/common';
import { forStorage } from '../../../common/persistence/storage-choice';
// feature:mongodb:start
import {
  MONGO_MAGIC_LINK_MODELS,
  MONGO_MAGIC_LINK_PROVIDERS,
} from './mongo/mongo-magic-link-persistence';
// feature:mongodb:end
import { POSTGRES_MAGIC_LINK_PROVIDERS } from './postgres/postgres-magic-link-persistence'; // feature:postgres

/** What MagicLinkModule runs on. The one place it names a database. */
export const MAGIC_LINK_PERSISTENCE_IMPORTS: DynamicModule[] = forStorage({
  mongodb: () => [MONGO_MAGIC_LINK_MODELS], // feature:mongodb
  postgres: () => [], // feature:postgres
});

export const MAGIC_LINK_PERSISTENCE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => MONGO_MAGIC_LINK_PROVIDERS, // feature:mongodb
  postgres: () => POSTGRES_MAGIC_LINK_PROVIDERS, // feature:postgres
});
