import { Provider } from '@nestjs/common';
import { SecondFactorChallengeStore } from '../../stores/second-factor-challenge.store';
import { SecondFactorSignIn } from '../../stores/second-factor-sign-in';
import { SecondFactorStore } from '../../stores/second-factor.store';
import { MongoSecondFactorChallengeStore } from './mongo-second-factor-challenge.store';
import { MongoSecondFactorSignIn } from './mongo-second-factor-sign-in';
import { MongoSecondFactorStore } from './mongo-second-factor.store';

/** What every sign-in path needs of the second factor, on MongoDB. */
export const MONGO_SECOND_FACTOR_STORES: Provider[] = [
  { provide: SecondFactorStore, useClass: MongoSecondFactorStore },
  {
    provide: SecondFactorChallengeStore,
    useClass: MongoSecondFactorChallengeStore,
  },
];

/** The session a correct second factor is owed, on MongoDB. */
export const MONGO_SECOND_FACTOR_SIGN_IN: Provider = {
  provide: SecondFactorSignIn,
  useClass: MongoSecondFactorSignIn,
};
