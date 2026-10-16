import type { Provider } from '@nestjs/common';
import { onDatabaseWithClock } from '../../../common/persistence/postgres/postgres-providers';
import { EmailCodeStore } from '../../pending-codes/email-code.store';
import { PostgresEmailCodeStore } from './postgres-email-code.store';

export const POSTGRES_EMAIL_CODE_PROVIDERS: Provider[] = [
  onDatabaseWithClock(
    EmailCodeStore,
    (database, clock) => new PostgresEmailCodeStore(database, clock),
  ),
];
