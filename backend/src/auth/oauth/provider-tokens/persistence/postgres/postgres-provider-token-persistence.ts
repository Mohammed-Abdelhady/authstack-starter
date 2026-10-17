import type { Provider } from '@nestjs/common';
import { onDatabase } from '../../../../../common/persistence/postgres/postgres-providers';
import { ProviderTokenStore } from '../../stores/provider-token.store';
import { PostgresProviderTokenStore } from './postgres-provider-token.store';

export const POSTGRES_PROVIDER_TOKEN_PROVIDERS: Provider[] = [
  onDatabase(
    ProviderTokenStore,
    (database) => new PostgresProviderTokenStore(database),
  ),
];
