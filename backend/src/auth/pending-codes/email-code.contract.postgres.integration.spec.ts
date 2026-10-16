import { openTestConnection } from '../../../test/postgres/postgres-connection';
import { FrozenClock, TEST_NOW } from '../../../test/utils/frozen-clock';
import { PostgresUnitOfWorkRunner } from '../../common/persistence/postgres/postgres-unit-of-work';
import {
  removeExpiredRows,
  RETENTION_RULES,
} from '../../common/persistence/postgres/postgres-retention';
import { PostgresEmailCodeStore } from '../persistence/postgres/postgres-email-code.store';
import { describeEmailCodeContract } from './email-code.harness-spec';

describeEmailCodeContract('PostgreSQL', async () => {
  const connection = await openTestConnection();
  const clock = new FrozenClock(TEST_NOW);
  return {
    store: new PostgresEmailCodeStore(connection.database, clock),
    clock,
    unitOfWork: new PostgresUnitOfWorkRunner(connection.database),
    reset: connection.reset,
    close: connection.close,
    checkSetup: async () => {
      expect(connection.appliedMigrations).toContain('0025_email_codes.sql');
      const indexes = await connection.pool.query<{ indexname: string }>(
        "SELECT indexname FROM pg_indexes WHERE tablename = 'email_codes'",
      );
      expect(indexes.rows.map((row) => row.indexname)).toEqual(
        expect.arrayContaining([
          'email_code_owner_purpose_unique',
          'email_code_purge_after',
        ]),
      );
    },
    // The retention job's own rule for the table, at the frozen time.
    cleanUp: async () => {
      await removeExpiredRows(
        connection.database,
        clock.now(),
        undefined,
        RETENTION_RULES.filter(({ table }) => table === 'email_codes'),
      );
    },
  };
});
