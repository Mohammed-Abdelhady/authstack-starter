import { PostgresSecurityEventStore } from '../../src/session/persistence/postgres/postgres-security-event.store';
import {
  openTestConnection,
  TestConnection,
} from '../postgres/postgres-connection';
import { removeExpiredRows } from '../../src/common/persistence/postgres/postgres-retention';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../postgres/server/postgres-test-server';
import { TEST_NOW } from '../utils/frozen-clock';

describe('activity purge deadline on PostgreSQL', () => {
  let connection: TestConnection | undefined;
  const current = (): TestConnection => {
    if (!connection) throw new Error('PostgreSQL did not start');
    return connection;
  };
  beforeAll(async () => {
    connection = await openTestConnection();
  }, POSTGRES_BOOT_TIMEOUT_MS);
  beforeEach(async () => {
    await current().reset();
  }, POSTGRES_RESET_TIMEOUT_MS);
  afterAll(async () => {
    await connection?.close();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  it('keeps readable evidence after the target account is physically deleted', async () => {
    const user = await current()
      .database.insertInto('users')
      .defaultValues()
      .returning('id')
      .executeTakeFirstOrThrow();
    const events = new PostgresSecurityEventStore(current().database);
    await events.appendOutsideUnitOfWork({
      eventId: 'deleted-target',
      actorId: 'staff-1',
      targetUserId: user.id,
      action: 'account_deleted',
      outcome: 'succeeded',
      occurredAt: TEST_NOW,
    });
    await current()
      .database.deleteFrom('users')
      .where('id', '=', user.id)
      .execute();
    const result = await events.listActivity(
      { page: 1, limit: 10, target: user.id },
      TEST_NOW,
    );
    expect(result.total).toBe(1);
    expect(result.data[0]).toMatchObject({
      eventId: 'deleted-target',
      targetUserId: user.id,
    });
  });

  it('runs the real purge and retains the row whose deadline has not passed', async () => {
    await current()
      .database.insertInto('security_events')
      .values([
        {
          event_id: 'overdue',
          action: 'account_deleted',
          outcome: 'succeeded',
          occurred_at: TEST_NOW,
          kind: 'staff',
          purge_after: TEST_NOW,
        },
        {
          event_id: 'future',
          action: 'account_deleted',
          outcome: 'succeeded',
          occurred_at: TEST_NOW,
          kind: 'staff',
          purge_after: new Date('2099-01-01T12:00:00.001Z'),
        },
      ])
      .execute();
    const pass = await removeExpiredRows(
      current().database,
      TEST_NOW,
      undefined,
      [{ table: 'security_events', column: 'purge_after', keepForMs: 0 }],
    );
    expect(pass).toEqual({ removed: { security_events: 1 }, failed: [] });
    const rows = await current()
      .database.selectFrom('security_events')
      .select('event_id')
      .execute();
    expect(rows).toEqual([{ event_id: 'future' }]);
  });
});
