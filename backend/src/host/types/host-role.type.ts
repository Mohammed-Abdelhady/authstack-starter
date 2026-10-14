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
