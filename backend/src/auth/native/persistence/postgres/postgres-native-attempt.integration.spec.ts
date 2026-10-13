import { openTestConnection } from '../../../../../test/postgres/postgres-connection';
import { FrozenClock, TEST_NOW } from '../../../../../test/utils/frozen-clock';
import { PostgresUnitOfWorkRunner } from '../../../../common/persistence/postgres/postgres-unit-of-work';
import { describeNativeAttemptContract } from '../native-attempt.harness-spec';
import { PostgresNativeAttemptStore } from './postgres-native-attempt.store';

describeNativeAttemptContract('PostgreSQL', async () => {
  const connection = await openTestConnection();
  const clock = new FrozenClock(TEST_NOW);
  return {
    store: new PostgresNativeAttemptStore(connection.database, clock),
    clock,
    unitOfWork: new PostgresUnitOfWorkRunner(connection.database),
    reset: connection.reset,
    close: connection.close,
    checkSetup: async () => {
      expect(connection.appliedMigrations).toContain(
        '0018_native_attempts.sql',
      );
      const indexes = await connection.pool.query<{ indexname: string }>(
        "SELECT indexname FROM pg_indexes WHERE tablename = 'native_attempts'",
      );
      expect(indexes.rows.map((row) => row.indexname)).toEqual(
        expect.arrayContaining([
          'native_attempts_attempt_id_key',
          'native_attempts_expires_at_idx',
        ]),
      );
    },
  };
});
