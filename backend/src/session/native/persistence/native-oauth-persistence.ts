import { Provider } from '@nestjs/common';
import { forStorage } from '../../../common/persistence/storage-choice';
import { MONGO_NATIVE_OAUTH_PROVIDERS } from './mongo/mongo-native-oauth-persistence'; // feature:mongodb
import { POSTGRES_NATIVE_OAUTH_PROVIDERS } from './postgres/postgres-native-oauth-persistence'; // feature:postgres

/** What NativeOAuthModule runs on. The one place it names a database. */
export const NATIVE_OAUTH_PERSISTENCE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => MONGO_NATIVE_OAUTH_PROVIDERS, // feature:mongodb
  postgres: () => POSTGRES_NATIVE_OAUTH_PROVIDERS, // feature:postgres
});
