import { PostgresStaffIdempotencyStore } from '../../src/admin/persistence/postgres/postgres-staff-idempotency.store';
import { PostgresUnitOfWorkRunner } from '../../src/common/persistence/postgres/postgres-unit-of-work';
import { FrozenClock, TEST_NOW } from '../utils/frozen-clock';
import { StaffIdempotencyHarness } from '../utils/staff-idempotency-contract/staff-idempotency-harness';
import { openTestConnection } from './postgres-connection';

export async function bootPostgresStaffIdempotencyHarness(): Promise<StaffIdempotencyHarness> {
  const connection = await openTestConnection();
  const { database } = connection;
  return {
    store: new PostgresStaffIdempotencyStore(),
    clock: new FrozenClock(TEST_NOW),
    runner: (pause) => new PostgresUnitOfWorkRunner(database, pause),
    records: async () => {
      const records = await database
        .selectFrom('staff_idempotency_keys')
        .select(['request_hash', 'resource_id'])
        .orderBy('actor_id')
        .execute();
      return records.map((record) => ({
        requestHash: record.request_hash,
        resourceId: record.resource_id,
      }));
    },
    reset: connection.reset,
    close: connection.close,
  };
}
