import { Provider } from '@nestjs/common';
import { onDatabaseWithClock } from '../../../../common/persistence/postgres/postgres-providers';
import { ProviderSignInStore } from '../../stores/provider-sign-in.store';
import { PostgresProviderSignInStore } from './postgres-provider-sign-in.store';

export const POSTGRES_OAUTH_PROVIDERS: Provider[] = [
  onDatabaseWithClock(
    ProviderSignInStore,
    (database, clock) => new PostgresProviderSignInStore(database, clock),
  ),
];
