import type { Provider } from '@nestjs/common';
import { forStorage } from '../../common/persistence/storage-choice';
import { MONGO_EMAIL_CODE_PROVIDERS } from './mongo/mongo-email-code-persistence'; // feature:mongodb
import { POSTGRES_EMAIL_CODE_PROVIDERS } from './postgres/postgres-email-code-persistence'; // feature:postgres

export const EMAIL_CODE_PERSISTENCE_PROVIDERS: Provider[] = forStorage({
  mongodb: () => MONGO_EMAIL_CODE_PROVIDERS, // feature:mongodb
  postgres: () => POSTGRES_EMAIL_CODE_PROVIDERS, // feature:postgres
});
