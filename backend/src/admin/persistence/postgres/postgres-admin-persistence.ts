import { Provider } from '@nestjs/common';
import { onDatabaseWithClock } from '../../../common/persistence/postgres/postgres-providers';
import { AdminAccountStore } from '../../stores/admin-account.store';
import { PostgresAdminAccountStore } from './postgres-admin-account.store';

export const POSTGRES_ADMIN_PROVIDERS: Provider[] = [
  onDatabaseWithClock(
    AdminAccountStore,
    (database, clock) => new PostgresAdminAccountStore(database, clock),
  ),
];
