import type { PostgresDatabase } from '../../src/common/persistence/postgres/postgres-connection';
import type { E2eRecordsState } from '../utils/e2e-state-records';

/**
 * The records state on PostgreSQL, through the adapter's own table map. An
 * update stamps the row as the other database's model does on every update.
 */
export function postgresRecordsState(
  database: PostgresDatabase,
): E2eRecordsState {
  return {
    changeAccountRole: async (id, role) => {
      await database
        .updateTable('users')
        .set({ role, updated_at: new Date() })
        .where('id', '=', id)
        .execute();
    },
    markAccountDeleted: async (id) => {
      await database
        .updateTable('users')
        .set({ is_deleted: true, updated_at: new Date() })
        .where('id', '=', id)
        .execute();
    },
    replaceAccountPermissions: async (id, permissions) => {
      await database
        .updateTable('users')
        .set({ permissions, updated_at: new Date() })
        .where('id', '=', id)
        .execute();
    },
    moveAddressGeneration: async (id, generation, isVerified) => {
      await database
        .updateTable('users')
        .set({
          address_generation: generation,
          is_verified: isVerified,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();
    },
  };
}
