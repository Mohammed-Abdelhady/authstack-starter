import {
  PERMISSION_PERMISSIONS,
  USER_PERMISSIONS,
} from '../../../../src/common/constants/permissions';
import { AccountsContractHarness } from './accounts-contract-harness';
import {
  AccountsFixture,
  ADMIN_SLUG,
  MANAGER_SLUG,
  SUPPORT_SLUG,
  DEFAULT_SLUG,
  EDITOR_SLUG,
  READ_POSTS,
  READ_USERS,
  OLD_PASSWORD,
  passwordHash,
} from './accounts-contract-support';

/**
 * The roles and accounts every case starts from: two admins, a manager, a
 * support agent and a plain account that has a password and one permission of
 * its own.
 */
export async function seedAccountsFixture(
  harness: AccountsContractHarness,
): Promise<AccountsFixture> {
  await harness.seedRole({
    name: 'Admin',
    slug: ADMIN_SLUG,
    level: 4,
    permissions: ['*'],
  });
  await harness.seedRole({
    name: 'Manager',
    slug: MANAGER_SLUG,
    level: 3,
    // What the admin services ask of an acting manager, and what it hands out.
    permissions: [
      READ_USERS,
      READ_POSTS,
      USER_PERMISSIONS.UPDATE_ALL,
      PERMISSION_PERMISSIONS.GRANT_ALL,
      PERMISSION_PERMISSIONS.REVOKE_ALL,
    ],
  });
  await harness.seedRole({
    name: 'Support',
    slug: SUPPORT_SLUG,
    level: 2,
    permissions: [],
  });
  const defaultRoleId = await harness.seedRole({
    name: 'User',
    slug: DEFAULT_SLUG,
    level: 1,
    permissions: [READ_POSTS],
  });
  const editorRoleId = await harness.seedRole({
    name: 'Content Editor',
    slug: EDITOR_SLUG,
    permissions: [READ_POSTS],
  });
  const at = (minute: number): Date =>
    new Date(Date.UTC(2098, 0, 1, 0, minute));
  return {
    adminId: await harness.seedAccount({
      email: 'admin@example.test',
      role: ADMIN_SLUG,
      createdAt: at(1),
    }),
    secondAdminId: await harness.seedAccount({
      email: 'second-admin@example.test',
      role: ADMIN_SLUG,
      createdAt: at(2),
    }),
    managerId: await harness.seedAccount({
      email: 'manager@example.test',
      role: MANAGER_SLUG,
      createdAt: at(3),
    }),
    supportId: await harness.seedAccount({
      email: 'support@example.test',
      role: SUPPORT_SLUG,
      createdAt: at(4),
    }),
    userId: await harness.seedAccount({
      email: 'person@example.test',
      name: 'Plain Person',
      role: DEFAULT_SLUG,
      permissions: [READ_USERS],
      passwordHash: await passwordHash(OLD_PASSWORD),
      createdAt: at(5),
    }),
    editorRoleId,
    defaultRoleId,
  };
}
