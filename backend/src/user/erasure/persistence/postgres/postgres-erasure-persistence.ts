import type { Provider } from '@nestjs/common';
import { onDatabase } from '../../../../common/persistence/postgres/postgres-providers';
import { AccountEraser } from '../../stores/account-eraser';
import { ErasureJobStore } from '../../stores/erasure-job.store';
import { PostgresAccountEraser } from './postgres-account-eraser';
import { PostgresErasureJobStore } from './postgres-erasure-job.store';

export const POSTGRES_ERASURE_PROVIDERS: Provider[] = [
  onDatabase(
    ErasureJobStore,
    (database) => new PostgresErasureJobStore(database),
  ),
  { provide: AccountEraser, useClass: PostgresAccountEraser },
];
