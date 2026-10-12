import { Provider } from '@nestjs/common';
import {
  onDatabase,
  onDatabaseWithClock,
} from '../../../common/persistence/postgres/postgres-providers';
import { AccountPermissionStore } from '../../stores/account-permission.store';
import { AccountProfileStore } from '../../stores/account-profile.store';
import { AccountSessions } from '../../stores/account-sessions';
import { LinkedAccountStore } from '../../stores/linked-account.store'; // feature:oauth-core
import { RevokerAccountSessions } from '../../stores/revoker-account-sessions';
import { SignInMethodStore } from '../../stores/sign-in-method.store';
import { PostgresAccountPermissionStore } from './postgres-account-permission.store';
import { PostgresAccountProfileStore } from './postgres-account-profile.store';
import { PostgresLinkedAccountStore } from './postgres-linked-account.store'; // feature:oauth-core
import { PostgresSignInMethodStore } from './postgres-sign-in-method.store';

export const POSTGRES_USER_PROVIDERS: Provider[] = [
  onDatabaseWithClock(
    AccountProfileStore,
    (database, clock) => new PostgresAccountProfileStore(database, clock),
  ),
  onDatabaseWithClock(
    AccountPermissionStore,
    (database, clock) => new PostgresAccountPermissionStore(database, clock),
  ),
  { provide: AccountSessions, useClass: RevokerAccountSessions },
  onDatabase(
    SignInMethodStore,
    (database) => new PostgresSignInMethodStore(database),
  ),
  // feature:oauth-core:start
  onDatabaseWithClock(
    LinkedAccountStore,
    (database, clock) => new PostgresLinkedAccountStore(database, clock),
  ),
  // feature:oauth-core:end
];
