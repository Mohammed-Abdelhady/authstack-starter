import { MongoAdminAccountStore } from '../../src/admin/persistence/mongo/mongo-admin-account.store';
import { MongoRoleCatalogStore } from '../../src/role/persistence/mongo/mongo-role-catalog.store';
import { MongoRoleChangeStore } from '../../src/role/persistence/mongo/mongo-role-change.store';
import {
  Role,
  RoleDocument,
  RoleSchema,
} from '../../src/role/persistence/mongo/schemas/role.schema';
import { SecurityEventService } from '../../src/session/persistence/mongo/security-event.service';
import { SecurityEventStore } from '../../src/session/events/security-event.store';
import { bootMongoAuthority } from '../utils/session/authority-contract/mongo-authority-harness';
import {
  StaffSessionHarness,
  staffSessionServices,
} from './session-harness.harness-spec';

export async function bootStaffMongo(): Promise<StaffSessionHarness> {
  const { harness: authority, booted } = await bootMongoAuthority(
    'staff_sessions_contract',
  );
  booted.connection.model(Role.name, RoleSchema);
  const roles = booted.connection.model<RoleDocument>(Role.name);
  await roles.init();
  return {
    authority,
    events: booted.app.get(SecurityEventStore),
    ...staffSessionServices(authority, {
      accounts: new MongoAdminAccountStore(booted.users, roles),
      roles: new MongoRoleChangeStore(
        roles,
        booted.users,
        booted.app.get(SecurityEventService),
      ),
      catalog: new MongoRoleCatalogStore(roles, booted.users),
    }),
    seedRoles: async () => {
      await roles.deleteMany({});
      await roles.insertMany([
        { name: 'user', slug: 'user', level: 1, permissions: [] },
        { name: 'support', slug: 'support', level: 2, permissions: [] },
        { name: 'manager', slug: 'manager', level: 3, permissions: [] },
        { name: 'admin', slug: 'admin', level: 4, permissions: [] },
      ]);
    },
    patchAccount: async (id, patch) => {
      if (Object.keys(patch).length === 0) return;
      await booted.users.updateOne(
        { _id: id },
        {
          $set: {
            ...(patch.role === undefined ? {} : { role: patch.role }),
            ...(patch.permissions === undefined
              ? {}
              : { permissions: patch.permissions }),
            ...(patch.deleted === undefined
              ? {}
              : { isDeleted: patch.deleted }),
          },
        },
      );
    },
  };
}
