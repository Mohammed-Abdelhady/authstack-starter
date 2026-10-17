/** Who a role is for. Stored with the role once `0023_account_audience.sql` lands. */
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

export const HOST_PERMISSIONS: readonly string[] = [];

export const HOST_ROLES: readonly HostRole[] = [
  {
    name: 'Support',
    slug: 'support',
    level: 2,
    audience: 'staff',
    permissions: ['profile:read:own', 'profile:update:own', 'users:read:all', 'sessions:read:all'],
    description: 'Customer support staff',
  },
  {
    name: 'Manager',
    slug: 'manager',
    level: 3,
    audience: 'staff',
    permissions: [
      'profile:read:own',
      'profile:update:own',
      'users:read:all',
      'users:update:all',
      'users:assign-role:all',
      'users:suspend:all',
      'sessions:read:all',
      'roles:read:all',
    ],
    description: 'Management staff',
  },
];
