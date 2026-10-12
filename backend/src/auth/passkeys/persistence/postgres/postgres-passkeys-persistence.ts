import { Provider } from '@nestjs/common';
import {
  onDatabase,
  onDatabaseWithClock,
} from '../../../../common/persistence/postgres/postgres-providers';
import { SignInCompletion } from '../../../services/sessions/sign-in-completion';
import { PasskeyAccounts, PasskeySignIn } from '../../stores/passkey-accounts';
import { PasskeyChallengeStore } from '../../stores/passkey-challenge.store';
import { PasskeyStore } from '../../stores/passkey.store';
import { PostgresPasskeyChallengeStore } from './postgres-passkey-challenge.store';
import {
  PostgresPasskeyAccounts,
  PostgresPasskeySignIn,
  PostgresPasskeyStore,
} from './postgres-passkey.store';

export const POSTGRES_PASSKEY_PROVIDERS: Provider[] = [
  onDatabaseWithClock(
    PasskeyStore,
    (database, clock) => new PostgresPasskeyStore(database, clock),
  ),
  onDatabase(
    PasskeyChallengeStore,
    (database) => new PostgresPasskeyChallengeStore(database),
  ),
  onDatabase(
    PasskeyAccounts,
    (database) => new PostgresPasskeyAccounts(database),
  ),
  {
    provide: PasskeySignIn,
    useFactory: (completion: SignInCompletion) =>
      new PostgresPasskeySignIn(completion),
    inject: [SignInCompletion],
  },
];
