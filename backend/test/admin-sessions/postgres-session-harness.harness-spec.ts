import { PostgresAdminAccountStore } from '../../src/admin/persistence/postgres/postgres-admin-account.store';
import { PostgresRoleCatalogStore } from '../../src/role/persistence/postgres/postgres-role-catalog.store';
import { PostgresRoleChangeStore } from '../../src/role/persistence/postgres/postgres-role-change.store';
import { PostgresSecurityEventStore } from '../../src/session/persistence/postgres/postgres-security-event.store';
import { bootPostgresAuthority } from '../postgres/postgres-authority-harness';
import {
  StaffSessionHarness,
  staffSessionServices,
} from './session-harness.harness-spec';

export async function bootStaffPostgres(): Promise<StaffSessionHarness> {
  const { harness: authority, issuance } = await bootPostgresAuthority();
  const { database, clock } = issuance;
  const events = new PostgresSecurityEventStore(database);
  return {
    authority,
    events,
    ...staffSessionServices(authority, {
      accounts: new PostgresAdminAccountStore(database, clock),
      roles: new PostgresRoleChangeStore(clock, events),
      catalog: new PostgresRoleCatalogStore(database),
    }),
    seedRoles: async () => {
      for (const [slug, level] of [
        ['user', 1],
        ['support', 2],
        ['manager', 3],
        ['admin', 4],
      ] as const) {
        await database
          .insertInto('roles')
          .values({
            name: slug,
            slug,
            level,
            permissions: [],
            created_at: clock.now(),
            updated_at: clock.now(),
          })
          .execute();
      }
    },
    patchAccount: async (id, patch) => {
      if (Object.keys(patch).length === 0) return;
      await database
        .updateTable('users')
        .set({
          role: patch.role,
          permissions: patch.permissions,
          is_deleted: patch.deleted,
        })
        .where('id', '=', id)
        .execute();
    },
  };
}
