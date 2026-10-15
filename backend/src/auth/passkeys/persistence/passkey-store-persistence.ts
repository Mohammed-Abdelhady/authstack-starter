import { type DynamicModule, type Provider } from '@nestjs/common';
import { forStorage } from '../../../common/persistence/storage-choice';
// feature:mongodb:start
import { MONGO_PASSKEY_MODELS } from './mongo/mongo-passkeys-persistence';
import { MONGO_PASSKEY_STORE_PROVIDER } from './mongo/mongo-passkey-stores';
// feature:mongodb:end
import { POSTGRES_PASSKEY_STORE_PROVIDER } from './postgres/postgres-passkeys-persistence'; // feature:postgres

export const PASSKEY_STORE_IMPORTS: DynamicModule[] = forStorage({
  mongodb: () => [MONGO_PASSKEY_MODELS], // feature:mongodb
  postgres: () => [], // feature:postgres
});

export const PASSKEY_STORE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => [MONGO_PASSKEY_STORE_PROVIDER], // feature:mongodb
  postgres: () => [POSTGRES_PASSKEY_STORE_PROVIDER], // feature:postgres
});
