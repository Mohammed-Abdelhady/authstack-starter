import { ADMIN_ROLE_SLUG, ROLE_REFUSAL, UNKNOWN_ROLE_LEVEL, type RoleRefusal } from '../constants';
import type { Role } from '../types';

/**
 * The level of the role a person holds, read from the role list. The server
 * gives a slug with no role level 0, so the same is done here.
 */
export function levelOfRole(roles: readonly Pick<Role, 'slug' | 'level'>[], slug: string): number {
  return roles.find((role) => role.slug === slug)?.level ?? UNKNOWN_ROLE_LEVEL;
}

/**
 * Why the server would refuse to give `role` to a user, or null when it would
 * accept. This is the server's own check: admin is never handed out, and any
 * other role must sit below the level of the person assigning it. Whether a
 * role is protected plays no part: that only guards the role itself.
 */
export function roleRefusal(
  actorLevel: number,
  role: Pick<Role, 'slug' | 'level'>,
): RoleRefusal | null {
  if (role.slug === ADMIN_ROLE_SLUG) return ROLE_REFUSAL.ADMIN;
  return actorLevel > role.level ? null : ROLE_REFUSAL.LEVEL;
}
