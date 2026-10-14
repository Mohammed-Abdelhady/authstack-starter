import { DEFAULT_ROLE_PERMISSIONS } from '../common/constants/permissions';
import { HostRole, ROLE_AUDIENCE } from './types/host-role.type';

/**
 * Permissions the host product adds to the core ones, as
 * `resource:action[:scope]`. Mirrored in `shared/core/src/host-access.ts`.
 */
export const HOST_PERMISSIONS: readonly string[] = [];

/**
 * Roles the host product seeds beside the core `user` and `admin` roles.
 * Replace these with the product's own. Mirrored in
 * `shared/core/src/host-access.ts`.
 */
export const HOST_ROLES: readonly HostRole[] = [
  {
    name: 'Support',
    slug: 'support',
    level: 2,
    audience: ROLE_AUDIENCE.STAFF,
    permissions: DEFAULT_ROLE_PERMISSIONS.support,
    description: 'Customer support staff',
  },
  {
    name: 'Manager',
    slug: 'manager',
    level: 3,
    audience: ROLE_AUDIENCE.STAFF,
    permissions: DEFAULT_ROLE_PERMISSIONS.manager,
    description: 'Management staff',
  },
];
