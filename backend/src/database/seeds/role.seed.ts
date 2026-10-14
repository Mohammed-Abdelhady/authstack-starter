import { Injectable } from '@nestjs/common';
import { buildRoleHierarchy } from '../../common/utils/role-hierarchy';
import { DEFAULT_ROLE_PERMISSIONS } from '../../common/constants/permissions';
import { HOST_ROLES } from '../../host/access';
import { HostRole } from '../../host/types/host-role.type';
import { UserRole } from '../../user/enums/user-role.enum';
import { ROLE_SEED, SeedRole, SeedStore } from './seed.store';

const SYSTEM_ROLE_FLAGS = {
  isSystemRole: true,
  isProtected: true,
  levelNeverLowers: false,
};

/**
 * The system roles a seed stores: the core `user` and `admin` roles around
 * the host product's roles.
 *
 * @param hostRoles - The host product's roles
 */
function systemSeedRoles(hostRoles: readonly HostRole[]): SeedRole[] {
  const levels = buildRoleHierarchy(hostRoles);
  return [
    {
      name: 'User',
      slug: UserRole.USER,
      description: 'Default role for all customers',
      ...SYSTEM_ROLE_FLAGS,
      level: levels[UserRole.USER],
      permissions: [...DEFAULT_ROLE_PERMISSIONS.user],
    },
    ...hostRoles.map((role) => ({
      name: role.name,
      slug: role.slug,
      description: role.description,
      ...SYSTEM_ROLE_FLAGS,
      level: role.level,
      permissions: [...role.permissions],
    })),
    {
      name: 'Admin',
      slug: UserRole.ADMIN,
      description: 'System administrator with full access',
      ...SYSTEM_ROLE_FLAGS,
      // Host roles a reseed drops stay stored, so admin never moves down.
      levelNeverLowers: true,
      level: levels[UserRole.ADMIN],
      permissions: [...DEFAULT_ROLE_PERMISSIONS.admin],
    },
  ];
}

/**
 * Seed service for the system roles: USER and ADMIN, and the host product's
 * roles in `HOST_ROLES`.
 */
@Injectable()
export class RoleSeedService {
  constructor(private readonly store: SeedStore) {}

  /**
   * Seed the system roles if they don't exist
   */
  async seed(hostRoles: readonly HostRole[] = HOST_ROLES): Promise<void> {
    for (const roleData of systemSeedRoles(hostRoles)) {
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
  async updateRolePermissions(
    hostRoles: readonly HostRole[] = HOST_ROLES,
  ): Promise<void> {
    for (const { slug, permissions } of systemSeedRoles(hostRoles)) {
      await this.store.replaceRolePermissions(slug, permissions);
      console.log(`Updated permissions for role: ${slug}`);
    }

    console.log('Role permission updates completed');
  }
}
