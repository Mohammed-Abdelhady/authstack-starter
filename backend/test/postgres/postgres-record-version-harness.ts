import { readAccount } from '../../src/user/persistence/postgres/postgres-account-rows';
import { PostgresRoleCatalogStore } from '../../src/role/persistence/postgres/postgres-role-catalog.store';
import { RecordVersionHarness } from '../utils/record-version-contract/record-version-harness';
import { TEST_NOW } from '../utils/frozen-clock';
import { openTestConnection } from './postgres-connection';

export async function bootPostgresRecordVersionHarness(): Promise<RecordVersionHarness> {
  const connection = await openTestConnection();
  const { database } = connection;
  const roles = new PostgresRoleCatalogStore(database);
  return {
    seed: async () => {
      const account = await database
        .insertInto('users')
        .values({ email: 'version@example.test', name: 'Before' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const role = await database
        .insertInto('roles')
        .values({
          name: 'Version',
          slug: 'version',
          created_at: TEST_NOW,
          updated_at: TEST_NOW,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { accountId: account.id, roleId: role.id };
    },
    accountVersion: async (id) => (await readAccount(database, id))?.version,
    roleVersion: async (id) => (await roles.findRole(id))?.version,
    editAccount: async (id) => {
      await database
        .updateTable('users')
        .set({ name: 'After', permissions: ['users:read:all'] })
        .where('id', '=', id)
        .execute();
    },
    editBookkeeping: async (id) => {
      await database
        .updateTable('users')
        .set((eb) => ({ session_version: eb('session_version', '+', 1) }))
        .where('id', '=', id)
        .execute();
      await database
        .updateTable('users')
        .set((eb) => ({ issuance_fence: eb('issuance_fence', '+', 1) }))
        .where('id', '=', id)
        .execute();
    },
    editRole: async (id) => {
      await database
        .updateTable('roles')
        .set({ permissions: ['users:read:all'] })
        .where('id', '=', id)
        .execute();
    },
    reset: connection.reset,
    close: connection.close,
  };
}
