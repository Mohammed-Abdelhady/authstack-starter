import { PostgresUnitOfWorkRunner } from '../../../common/persistence/postgres/postgres-unit-of-work';
import { PostgresAudienceMappingStore } from './postgres-audience-mapping.store';
import {
  openTestConnection,
  type TestConnection,
} from '../../../../test/postgres/postgres-connection';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/postgres/server/postgres-test-server';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';

describe('audience inventory locks on PostgreSQL', () => {
  let connection: TestConnection;
  beforeAll(async () => {
    connection = await openTestConnection();
    await connection.database
      .insertInto('roles')
      .values({
        slug: 'user',
        name: 'User',
        level: 1,
        created_at: TEST_NOW,
        updated_at: TEST_NOW,
      })
      .execute();
    await connection.database
      .insertInto('users')
      .values({
        email: 'audience-lock@example.test',
        name: 'Lock Customer',
        role: 'user',
      })
      .execute();
  }, POSTGRES_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await connection?.close();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  // Failure: a dry run blocks writes, or a real mapping fails to lock its inventory.
  it.each([false, true])(
    'requests row locks only for a real mapping: %s',
    async (lock) => {
      const runner = new PostgresUnitOfWorkRunner(connection.database);
      const store = new PostgresAudienceMappingStore();
      await runner.run(async (work) => {
        const snapshot = await store.snapshot(work, { lock });
        const account = snapshot.accounts[0];
        const role = snapshot.roles[0];
        if (!account || !role) throw new Error('Expected inventory records');
        for (const [table, id] of [
          ['users', account.id],
          ['roles', role.id],
        ] as const) {
          const otherWriter = connection.database
            .transaction()
            .execute((transaction) =>
              transaction
                .selectFrom(table)
                .select('id')
                .where('id', '=', id)
                .forUpdate()
                .noWait()
                .executeTakeFirstOrThrow(),
            );
          if (lock) {
            await expect(otherWriter).rejects.toHaveProperty('code', '55P03');
          } else {
            await expect(otherWriter).resolves.toEqual({ id });
          }
        }
      });
    },
  );
});
