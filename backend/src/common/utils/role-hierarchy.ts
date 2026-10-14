import { UserRole } from '../../user/enums/user-role.enum';
import { HOST_ROLES } from '../../host/access';
import { HostRole } from '../../host/types/host-role.type';

/** Level of the core `user` role, and the lowest level a role can hold. */
export const USER_LEVEL = 1;

/**
 * Level of the core `admin` role while every host role sits below it.
 * A floor, never lowered: databases seeded before host roles store admin at 4,
 * and a reseed must not move their hierarchy down.
 */
const DEFAULT_ADMIN_LEVEL = 4;

/** Highest host level. Admin takes the next one, which must fit a signed 32-bit integer column. */
export const MAX_HOST_ROLE_LEVEL = 2_147_483_646;

const CORE_ROLE_SLUGS: readonly string[] = [UserRole.USER, UserRole.ADMIN];

/**
 * A slug the role slug normaliser (`generateSlug` in role/utils/role.util.ts)
 * leaves as it is: lowercase letters, digits and single hyphens, not empty.
 */
const CANONICAL_ROLE_SLUG = /^(?!.*--)[a-z0-9-]+$/;

/** Whether `generateSlug` would store this slug unchanged. */
export function isCanonicalRoleSlug(slug: string): boolean {
  return CANONICAL_ROLE_SLUG.test(slug);
}

/**
 * Refuse host roles the hierarchy cannot place: a level that is not an
 * integer from 1 to MAX_HOST_ROLE_LEVEL, a slug the normaliser would change,
 * a core slug, or a slug used twice.
 *
 * @throws Error naming the first role at fault
 */
export function assertValidHostRoles(hostRoles: readonly HostRole[]): void {
  const seen = new Set<string>();
  for (const role of hostRoles) {
    if (
      !Number.isInteger(role.level) ||
      role.level < USER_LEVEL ||
      role.level > MAX_HOST_ROLE_LEVEL
    ) {
      throw new Error(
        `Host role "${role.slug}" needs an integer level from ${USER_LEVEL} to ${MAX_HOST_ROLE_LEVEL}`,
      );
    }
    if (!isCanonicalRoleSlug(role.slug)) {
      throw new Error(
        `Host role slug "${role.slug}" must be lowercase letters, digits and single hyphens`,
      );
    }
    if (CORE_ROLE_SLUGS.includes(role.slug) || seen.has(role.slug)) {
      throw new Error(
        `Host role slug "${role.slug}" is a core role or is used twice`,
      );
    }
    seen.add(role.slug);
  }
}

/**
 * Levels of the core roles and the host roles. `admin` stays above every
 * host role: max(4, highest host level + 1).
 *
 * @param hostRoles - The host product's roles
 */
export function buildRoleHierarchy(
  hostRoles: readonly HostRole[],
): Record<string, number> {
  assertValidHostRoles(hostRoles);
  const highestBelowAdmin = Math.max(
    DEFAULT_ADMIN_LEVEL - 1,
    ...hostRoles.map((role) => role.level),
  );
  return {
    [UserRole.USER]: USER_LEVEL,
    ...Object.fromEntries(hostRoles.map((role) => [role.slug, role.level])),
    [UserRole.ADMIN]: highestBelowAdmin + 1,
  };
}

/**
 * Levels of the system roles. Higher levels manage lower ones.
 * This map seeds the stored roles and backs roles written before roles
 * carried a level. Live checks read the level from the database, so custom
 * roles take part in the hierarchy as well.
 */
export const ROLE_HIERARCHY: Record<string, number> =
  buildRoleHierarchy(HOST_ROLES);

/**
 * Level given to a role that exists but carries no explicit level.
 * Custom roles sit alongside the default user role.
 */
export const CUSTOM_ROLE_LEVEL = USER_LEVEL;

/**
 * Level given to a role slug that is no longer a stored role.
 * Only admins may touch users stranded on such a slug.
 */
export const UNKNOWN_ROLE_LEVEL = 0;

/**
 * Whether a role slug is the stored admin role. Admin-only checks use this,
 * never a level: a custom role can sit at a level admin once held.
 */
export function isAdminRole(roleSlug: string): boolean {
  return roleSlug === (UserRole.ADMIN as string);
}

/** The acting account as the level checks see it. */
export interface LevelActor {
  level: number;
  /** Holds the stored admin role, see `isAdminRole`. */
  isAdmin: boolean;
}

/**
 * Get role hierarchy level for a role string.
 * Custom roles (not in hierarchy) default to level 0.
 *
 * @param role - Role slug or UserRole enum value
 * @returns Hierarchy level (0 for custom roles)
 */
function getRoleLevel(role: string | UserRole): number {
  return seededRoleLevel(role) ?? UNKNOWN_ROLE_LEVEL;
}

/**
 * Seeded level of a system role slug, or undefined for any other slug.
 * Own properties only, so `constructor` or `__proto__` is not a system role.
 *
 * @param slug - Role slug
 */
export function seededRoleLevel(slug: string): number | undefined {
  return Object.hasOwn(ROLE_HIERARCHY, slug) ? ROLE_HIERARCHY[slug] : undefined;
}

/**
 * Check whether an actor may act on a target level in a read-only way.
 * Equal levels pass. Stranded roles (level 0) are admin-only.
 *
 * @param actor - Level and admin role of the acting user
 * @param targetLevel - Hierarchy level of the target user
 * @returns true when the actor may read the target
 */
export function canManageLevel(
  actor: LevelActor,
  targetLevel: number,
): boolean {
  if (targetLevel === UNKNOWN_ROLE_LEVEL) {
    return actor.isAdmin;
  }

  return actor.level >= targetLevel;
}

/**
 * Check whether an actor may mutate a target level.
 * Equal levels fail, so peers cannot act on each other.
 * Stranded roles (level 0) are admin-only.
 *
 * @param actor - Level and admin role of the acting user
 * @param targetLevel - Hierarchy level of the target user
 * @returns true when the actor may mutate the target
 */
export function canModifyLevel(
  actor: LevelActor,
  targetLevel: number,
): boolean {
  if (targetLevel === UNKNOWN_ROLE_LEVEL) {
    return actor.isAdmin;
  }

  return actor.level > targetLevel;
}

/**
 * Check if a user has at least the minimum required role.
 *
 * @param userRole - The user's current role (string or enum)
 * @param requiredRole - The minimum role required (string or enum)
 * @returns true if user has sufficient permissions
 *
 * @example
 * ```typescript
 * hasMinimumRole('manager', 'user'); // true
 * hasMinimumRole('user', 'manager'); // false
 * hasMinimumRole(UserRole.MANAGER, UserRole.USER); // true (backward compat)
 * ```
 */
export function hasMinimumRole(
  userRole: string | UserRole,
  requiredRole: string | UserRole,
): boolean {
  return getRoleLevel(userRole) >= getRoleLevel(requiredRole);
}

/**
 * Check if a role assignment is valid.
 * ADMIN role cannot be assigned via API (only through database).
 * Custom roles can be assigned.
 *
 * @param newRole - The role to be assigned
 * @returns true if the role can be assigned
 *
 * @example
 * ```typescript
 * isValidRoleAssignment('support'); // true
 * isValidRoleAssignment('admin'); // false
 * isValidRoleAssignment('custom-role'); // true
 * ```
 */
export function isValidRoleAssignment(newRole: string | UserRole): boolean {
  return newRole !== (UserRole.ADMIN as string);
}
