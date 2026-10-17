import { PostgresUnitOfWorkRunner } from '../../../common/persistence/postgres/postgres-unit-of-work';
import { sql } from 'kysely';
import {
  openTestConnection,
  TestConnection,
} from '../../../../test/postgres/postgres-connection';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/postgres/server/postgres-test-server';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import { PostgresAdminAccountStore } from './postgres-admin-account.store';

const FIRST_LINK = new Date('2098-06-01T00:00:00.000Z');
const SECOND_LINK = new Date('2098-06-02T00:00:00.000Z');

/** What listing accounts costs on PostgreSQL, where links are rows of their own. */
describe('PostgreSQL admin account list', () => {
  let connection: TestConnection;

  beforeAll(async () => {
    connection = await openTestConnection();
  }, POSTGRES_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await connection?.close();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await connection.reset();
    await sql`
      INSERT INTO users (email, name, role, created_at, updated_at)
      SELECT 'account-' || lpad(n::text, 3, '0') || '@example.test',
             'Listed', 'user', ${TEST_NOW}, ${TEST_NOW}
        FROM generate_series(1, 120) AS n`.execute(connection.database);
    await sql`
      INSERT INTO user_linked_accounts (user_id, provider, provider_id, linked_at)
      SELECT users.id, link.provider, link.provider_id, link.linked_at
        FROM (VALUES
          ('account-002@example.test', 'provider-a', 'a-2', ${FIRST_LINK}::timestamptz),
          ('account-002@example.test', 'provider-b', 'b-2', ${SECOND_LINK}::timestamptz),
          ('account-100@example.test', 'provider-b', 'b-100', ${FIRST_LINK}::timestamptz),
          ('account-101@example.test', 'provider-a', 'a-101', ${FIRST_LINK}::timestamptz)
        ) AS link (email, provider, provider_id, linked_at)
        JOIN users ON users.email = link.email
       ORDER BY link.linked_at`.execute(connection.database);
  }, POSTGRES_RESET_TIMEOUT_MS);

  it('clears the pending address and staff marker with one normal version advance', async () => {
    const store = new PostgresAdminAccountStore(
      connection.database,
      new FrozenClock(TEST_NOW),
    );
    const first = await connection.database
      .selectFrom('users')
      .select(['id', 'email'])
      .orderBy('email')
      .executeTakeFirstOrThrow();
    const runner = new PostgresUnitOfWorkRunner(connection.database);
    const pending = await runner.run(async (work) => {
      const account = await store.takeAccountForChange(work, first.id);
      if (!account) throw new Error('The account is missing');
      return store.saveIdentity(work, account, {
        address: { email: 'pending@example.test', addressGeneration: 1 },
      });
    });
    await runner.run(async (work) => {
      const account = await store.takeAccountForChange(work, first.id);
      if (!account) throw new Error('The account is missing');
      await store.saveIdentity(work, account, {
        address: { email: null, addressGeneration: 2 },
      });
    });
    expect(
      await connection.database
        .selectFrom('users')
        .select([
          'email',
          'pending_email',
          'pending_email_initiator',
          'address_generation',
          'version',
        ])
        .where('id', '=', first.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({
      email: first.email,
      pending_email: null,
      pending_email_initiator: null,
      address_generation: 2,
      version: (pending.version ?? 0) + 1,
    });
  });
});
