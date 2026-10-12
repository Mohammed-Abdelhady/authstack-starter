import { Provider } from '@nestjs/common';
import {
  onDatabase,
  onDatabaseWithClock,
} from '../../../common/persistence/postgres/postgres-providers';
import { PostgresRolePermissions } from '../../../role/persistence/postgres/postgres-role-permissions';
import { RolePermissions } from '../../../role/stores/role-permissions';
import {
  ActivationAccounts,
  ActivationSignIn,
} from '../../pending-codes/activation-accounts';
import { MailCounterStore } from '../../pending-codes/mail-counter.store';
import { PasswordResetCodeStore } from '../../pending-codes/password-reset-code.store';
import { PendingRegistrationStore } from '../../pending-codes/pending-registration.store';
import { SignInCompletion } from '../../services/sessions/sign-in-completion';
import { PasswordSignInStore } from '../../stores/password-sign-in.store';
import { POSTGRES_SECOND_FACTOR_STORES } from '../../two-factor/persistence/postgres/postgres-second-factor-stores'; // feature:totp
import {
  PostgresActivationAccounts,
  PostgresActivationSignIn,
} from './postgres-activation-accounts';
import { PostgresMailCounterStore } from './postgres-mail-counter.store';
import { PostgresPasswordResetCodeStore } from './postgres-password-reset-code.store';
import { PostgresPasswordSignInStore } from './postgres-password-sign-in.store';
import { PostgresPendingRegistrationStore } from './postgres-pending-registration.store';

export const POSTGRES_AUTH_PROVIDERS: Provider[] = [
  onDatabase(
    MailCounterStore,
    (database) => new PostgresMailCounterStore(database),
  ),
  onDatabase(
    PendingRegistrationStore,
    (database) => new PostgresPendingRegistrationStore(database),
  ),
  onDatabase(
    PasswordResetCodeStore,
    (database) => new PostgresPasswordResetCodeStore(database),
  ),
  onDatabaseWithClock(
    ActivationAccounts,
    (database, clock) => new PostgresActivationAccounts(database, clock),
  ),
  {
    provide: ActivationSignIn,
    useFactory: (completion: SignInCompletion) =>
      new PostgresActivationSignIn(completion),
    inject: [SignInCompletion],
  },
  onDatabaseWithClock(
    PasswordSignInStore,
    (database, clock) => new PostgresPasswordSignInStore(database, clock),
  ),
  onDatabase(
    RolePermissions,
    (database) => new PostgresRolePermissions(database),
  ),
  ...POSTGRES_SECOND_FACTOR_STORES, // feature:totp
];
