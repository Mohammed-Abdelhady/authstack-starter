import { Provider } from '@nestjs/common';
import { onDatabase } from '../../../../common/persistence/postgres/postgres-providers';
import { SignInCompletion } from '../../../services/sessions/sign-in-completion';
import { SecondFactorChallengeStore } from '../../stores/second-factor-challenge.store';
import { SecondFactorSignIn } from '../../stores/second-factor-sign-in';
import { SecondFactorStore } from '../../stores/second-factor.store';
import { PostgresSecondFactorChallengeStore } from './postgres-second-factor-challenge.store';
import { PostgresSecondFactorStore } from './postgres-second-factor.store';
import { PostgresSecondFactorSignIn } from './postgres-second-factor-sign-in';

/** What every sign-in path needs of the second factor, on PostgreSQL. */
export const POSTGRES_SECOND_FACTOR_STORES: Provider[] = [
  onDatabase(
    SecondFactorStore,
    (database) => new PostgresSecondFactorStore(database),
  ),
  onDatabase(
    SecondFactorChallengeStore,
    (database) => new PostgresSecondFactorChallengeStore(database),
  ),
];

/** The session a correct second factor is owed, on PostgreSQL. */
export const POSTGRES_SECOND_FACTOR_SIGN_IN: Provider = {
  provide: SecondFactorSignIn,
  useFactory: (completion: SignInCompletion) =>
    new PostgresSecondFactorSignIn(completion),
  inject: [SignInCompletion],
};
