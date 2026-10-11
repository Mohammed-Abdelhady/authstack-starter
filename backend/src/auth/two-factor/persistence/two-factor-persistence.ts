import { Provider } from '@nestjs/common';
import { forStorage } from '../../../common/persistence/storage-choice';
import { MONGO_SECOND_FACTOR_SIGN_IN } from './mongo/mongo-second-factor-stores'; // feature:mongodb
import { POSTGRES_SECOND_FACTOR_SIGN_IN } from './postgres/postgres-second-factor-stores'; // feature:postgres

/** What TwoFactorModule runs on. The one place it names a database. */
export const TWO_FACTOR_PERSISTENCE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => [MONGO_SECOND_FACTOR_SIGN_IN], // feature:mongodb
  postgres: () => [POSTGRES_SECOND_FACTOR_SIGN_IN], // feature:postgres
});
