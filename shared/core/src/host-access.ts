import {
  PROFILE_PERMISSIONS,
  ROLE_PERMISSIONS,
  SESSION_PERMISSIONS,
  USER_PERMISSIONS,
} from './permissions';

/**
 * The host product's permissions and roles. The server's copy is
 * `backend/src/host/access.ts`, and a test fails when the two drift apart.
 */

/** Who a role is for. */
export const ROLE_AUDIENCE = {
  CUSTOMER: 'customer',
  STAFF: 'staff',
} as const;

export type RoleAudience = (typeof ROLE_AUDIENCE)[keyof typeof ROLE_AUDIENCE];

/** A role the host product adds beside the core `user` and `admin` roles. */
export interface HostRole {
  name: string;
  slug: string;
  /** Higher levels manage lower ones. An integer of at least 1. */
  level: number;
  audience: RoleAudience;
  permissions: readonly string[];
  description: string;
}

/** Permissions the host product adds to the core ones, as `resource:action[:scope]`. */
export const HOST_PERMISSIONS: readonly string[] = [];

/** Roles the host product seeds beside the core `user` and `admin` roles. */
export const HOST_ROLES: readonly HostRole[] = [
  {
    name: 'Support',
    slug: 'support',
    level: 2,
    audience: ROLE_AUDIENCE.STAFF,
    permissions: [
      PROFILE_PERMISSIONS.READ_OWN,
      PROFILE_PERMISSIONS.UPDATE_OWN,
      USER_PERMISSIONS.READ_ALL,
      SESSION_PERMISSIONS.READ_ALL,
    ],
    description: 'Customer support staff',
  },
  {
    name: 'Manager',
    slug: 'manager',
    level: 3,
    audience: ROLE_AUDIENCE.STAFF,
    permissions: [
      PROFILE_PERMISSIONS.READ_OWN,
      PROFILE_PERMISSIONS.UPDATE_OWN,
      USER_PERMISSIONS.READ_ALL,
      USER_PERMISSIONS.UPDATE_ALL,
      SESSION_PERMISSIONS.READ_ALL,
      ROLE_PERMISSIONS.READ_ALL,
    ],
    description: 'Management staff',
  },
];
