import { Injectable } from '@nestjs/common';
import { ROLE_HIERARCHY } from '../../common/utils/role-hierarchy';
import { DEFAULT_ROLE_PERMISSIONS } from '../../common/constants/permissions';
import { ROLE_SEED, SeedRole, SeedStore } from './seed.store';

/**
 * Seed service for default system roles.
 * Creates USER, SUPPORT, MANAGER, and ADMIN roles with appropriate permissions.
 */
@Injectable()
export class RoleSeedService {
  constructor(private readonly store: SeedStore) {}

  /**
   * Seed default roles if they don't exist
   */
  async seed(): Promise<void> {
    const defaultRoles: SeedRole[] = [
      {
        name: 'User',
        slug: 'user',
        description: 'Default role for all customers',
        isSystemRole: true,
        isProtected: true,
        level: ROLE_HIERARCHY.user,
        permissions: [...DEFAULT_ROLE_PERMISSIONS.user],
      },
      {
        name: 'Support',
        slug: 'support',
        description: 'Customer support staff',
        isSystemRole: true,
        isProtected: true,
        level: ROLE_HIERARCHY.support,
        permissions: [...DEFAULT_ROLE_PERMISSIONS.support],
      },
      {
        name: 'Manager',
        slug: 'manager',
        description: 'Management staff',
        isSystemRole: true,
        isProtected: true,
        level: ROLE_HIERARCHY.manager,
        permissions: [...DEFAULT_ROLE_PERMISSIONS.manager],
      },
      {
        name: 'Admin',
        slug: 'admin',
        description: 'System administrator with full access',
        isSystemRole: true,
        isProtected: true,
        level: ROLE_HIERARCHY.admin,
        permissions: [...DEFAULT_ROLE_PERMISSIONS.admin],
      },
    ];

    for (const roleData of defaultRoles) {
      const outcome = await this.store.seedRole(roleData);

      if (outcome === ROLE_SEED.CREATED) {
        console.log(`Created default role: ${roleData.name}`);
        continue;
      }

      console.log(`Role "${roleData.name}" exists, flags refreshed`);
    }

    console.log('Role seeding completed');
  }

  /**
   * Update existing roles' permissions (for migrations)
   */
  async updateRolePermissions(): Promise<void> {
    const updates = [
      {
        slug: 'user',
        permissions: [...DEFAULT_ROLE_PERMISSIONS.user],
      },
      {
        slug: 'support',
        permissions: [...DEFAULT_ROLE_PERMISSIONS.support],
      },
      {
        slug: 'manager',
        permissions: [...DEFAULT_ROLE_PERMISSIONS.manager],
      },
      {
        slug: 'admin',
        permissions: [...DEFAULT_ROLE_PERMISSIONS.admin],
      },
    ];

    for (const update of updates) {
      await this.store.replaceRolePermissions(update.slug, update.permissions);
      console.log(`Updated permissions for role: ${update.slug}`);
    }

    console.log('Role permission updates completed');
  }
}
