import type { Provider } from '@nestjs/common';
import { onDatabaseWithClock } from '../../../../common/persistence/postgres/postgres-providers';
import { NativeAttemptStore } from '../../stores/native-attempt.store';
import { PostgresNativeAttemptStore } from './postgres-native-attempt.store';

export const POSTGRES_NATIVE_ATTEMPT_PROVIDERS: Provider[] = [
  onDatabaseWithClock(
    NativeAttemptStore,
    (database, clock) => new PostgresNativeAttemptStore(database, clock),
  ),
];
