import { Provider } from '@nestjs/common';
import { onDatabaseWithClock } from '../../../../common/persistence/postgres/postgres-providers';
import { SeedStore } from '../../seed.store';
import { PostgresSeedStore } from './postgres-seed.store';

export const POSTGRES_SEED_PROVIDERS: Provider[] = [
  onDatabaseWithClock(
    SeedStore,
    (database, clock) => new PostgresSeedStore(database, clock),
  ),
];
