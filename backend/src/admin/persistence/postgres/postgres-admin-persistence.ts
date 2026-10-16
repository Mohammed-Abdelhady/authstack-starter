// feature:invitations:start
import { POSTGRES_PASSKEY_RESET_PROVIDER } from './postgres-passkey-reset.store'; // feature:passkeys
// feature:invitations:end
import { Provider } from '@nestjs/common';
import { onDatabaseWithClock } from '../../../common/persistence/postgres/postgres-providers';
import { AdminAccountStore } from '../../stores/admin-account.store';
import { AdminRosterStore } from '../../stores/admin-roster.store';
import { PostgresAdminRosterStore } from './postgres-admin-roster.store';
import { PostgresAdminAccountStore } from './postgres-admin-account.store';

export const POSTGRES_ADMIN_PROVIDERS: Provider[] = [
  onDatabaseWithClock(
    AdminAccountStore,
    (database, clock) => new PostgresAdminAccountStore(database, clock),
  ),
  { provide: AdminRosterStore, useClass: PostgresAdminRosterStore },
  // feature:invitations:start
  POSTGRES_PASSKEY_RESET_PROVIDER, // feature:passkeys
  // feature:invitations:end
];
