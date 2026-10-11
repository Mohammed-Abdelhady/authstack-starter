import { DynamicModule, Provider } from '@nestjs/common';
import { forStorage } from '../../../common/persistence/storage-choice';
// feature:mongodb:start
import {
  MONGO_PASSKEY_MODELS,
  MONGO_PASSKEY_PROVIDERS,
} from './mongo/mongo-passkeys-persistence';
// feature:mongodb:end
import { POSTGRES_PASSKEY_PROVIDERS } from './postgres/postgres-passkeys-persistence'; // feature:postgres

/** What PasskeysModule runs on. The one place it names a database. */
export const PASSKEYS_PERSISTENCE_IMPORTS: DynamicModule[] = forStorage({
  mongodb: () => [MONGO_PASSKEY_MODELS], // feature:mongodb
  postgres: () => [], // feature:postgres
});

export const PASSKEYS_PERSISTENCE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => MONGO_PASSKEY_PROVIDERS, // feature:mongodb
  postgres: () => POSTGRES_PASSKEY_PROVIDERS, // feature:postgres
});
