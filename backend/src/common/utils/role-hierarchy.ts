import { UserRole } from '../../user/enums/user-role.enum';

/**
 * Levels of the four system roles. Higher levels manage lower ones.
 * This map seeds the stored roles and backs roles written before roles
 * carried a level. Live checks read the level from the database, so custom
 * roles take part in the hierarchy as well.
 */
export const ROLE_HIERARCHY: Record<string, number> = {
  user: 1,
  support: 2,
  manager: 3,
  admin: 4,
} as const;

/**
 * Level given to a role that exists but carries no explicit level.
 * Custom roles sit alongside the default user role.
 */
export const CUSTOM_ROLE_LEVEL = 1;

/**
 * Level given to a role slug that is no longer a stored role.
 * Only admins may touch users stranded on such a slug.
 */
export const UNKNOWN_ROLE_LEVEL = 0;

/**
 * Level an actor must reach to perform admin-only operations.
 */
export const ADMIN_LEVEL = ROLE_HIERARCHY[UserRole.ADMIN];

/**
 * Get role hierarchy level for a role string.
 * Custom roles (not in hierarchy) default to level 0.
 *
 * @param role - Role slug or UserRole enum value
 * @returns Hierarchy level (0 for custom roles)
 */
function getRoleLevel(role: string | UserRole): number {
  return ROLE_HIERARCHY[role] ?? UNKNOWN_ROLE_LEVEL;
}

/**
 * Check whether an actor level may act on a target level in a read-only way.
 * Equal levels pass. Stranded roles (level 0) are admin-only.
 *
 * @param actorLevel - Hierarchy level of the acting user
 * @param targetLevel - Hierarchy level of the target user
 * @returns true when the actor may read the target
 */
export function canManageLevel(
  actorLevel: number,
  targetLevel: number,
): boolean {
  if (targetLevel === UNKNOWN_ROLE_LEVEL) {
    return actorLevel >= ADMIN_LEVEL;
  }

  return actorLevel >= targetLevel;
}

/**
 * Check whether an actor level may mutate a target level.
 * Equal levels fail, so peers cannot act on each other.
 * Stranded roles (level 0) are admin-only.
 *
 * @param actorLevel - Hierarchy level of the acting user
 * @param targetLevel - Hierarchy level of the target user
 * @returns true when the actor may mutate the target
 */
export function canModifyLevel(
  actorLevel: number,
  targetLevel: number,
): boolean {
  if (targetLevel === UNKNOWN_ROLE_LEVEL) {
    return actorLevel >= ADMIN_LEVEL;
  }

  return actorLevel > targetLevel;
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
