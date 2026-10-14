import { WILDCARD_PERMISSION } from './permissions';

/**
 * Check if a user has a specific permission.
 * Supports wildcard permission (*) which grants all access.
 *
 * @param userPermissions - Array of permissions the user has
 * @param requiredPermission - The permission to check for
 * @returns true if user has the permission
 *
 * @example
 * ```typescript
 * hasPermission(['users:read:all', 'users:update:all'], 'users:read:all'); // true
 * hasPermission(['*'], 'anything'); // true (wildcard)
 * hasPermission(['users:read:all'], 'users:delete:all'); // false
 * ```
 */
export function hasPermission(userPermissions: string[], requiredPermission: string): boolean {
  if (!userPermissions || userPermissions.length === 0) {
    return false;
  }

  // Check for wildcard permission (grants all access)
  if (userPermissions.includes(WILDCARD_PERMISSION)) {
    return true;
  }

  // Direct permission match
  return userPermissions.includes(requiredPermission);
}

/**
 * Check if a user holds at least one required permission (OR logic).
 *
 * @param userPermissions - Array of permissions the user has
 * @param requiredPermissions - Array of permissions to check (user needs at least one)
 * @returns true if user has at least one of the required permissions
 *
 * @example
 * ```typescript
 * hasAnyPermission(['users:read:all'], ['users:read:all', 'users:update:all']); // true
 * hasAnyPermission(['users:read:all'], ['users:delete:all', 'users:create:all']); // false
 * ```
 */
export function hasAnyPermission(
  userPermissions: string[],
  requiredPermissions: string[],
): boolean {
  if (!userPermissions || userPermissions.length === 0) {
    return false;
  }

  if (!requiredPermissions || requiredPermissions.length === 0) {
    return false;
  }

  // Check for wildcard permission
  if (userPermissions.includes(WILDCARD_PERMISSION)) {
    return true;
  }

  // Check if user has at least one of the required permissions
  return requiredPermissions.some((perm) => userPermissions.includes(perm));
}

/**
 * Check if a user has all of the required permissions (AND logic).
 *
 * @param userPermissions - Array of permissions the user has
 * @param requiredPermissions - Array of permissions to check (user needs all)
 * @returns true if user has all required permissions
 *
 * @example
 * ```typescript
 * hasAllPermissions(['users:read:all', 'users:update:all'], ['users:read:all', 'users:update:all']); // true
 * hasAllPermissions(['users:read:all'], ['users:read:all', 'users:update:all']); // false
 * ```
 */
export function hasAllPermissions(
  userPermissions: string[],
  requiredPermissions: string[],
): boolean {
  if (!userPermissions || userPermissions.length === 0) {
    return false;
  }

  if (!requiredPermissions || requiredPermissions.length === 0) {
    return true; // No permissions required
  }

  // Check for wildcard permission
  if (userPermissions.includes(WILDCARD_PERMISSION)) {
    return true;
  }

  // Check if user has all required permissions
  return requiredPermissions.every((perm) => userPermissions.includes(perm));
}

/**
 * Check if permissions array contains wildcard.
 *
 * @param permissions - Array of permissions to check
 * @returns true if wildcard permission is present
 */
export function hasWildcardPermission(permissions: string[]): boolean {
  return permissions.includes(WILDCARD_PERMISSION);
}

/**
 * Filter permissions by resource category.
 *
 * @param permissions - Array of permissions
 * @param resource - Resource to filter by (e.g., 'users', 'roles')
 * @returns Permissions matching the resource
 *
 * @example
 * ```typescript
 * filterPermissionsByResource(
 *   ['users:read:all', 'roles:read:all', 'users:update:all'],
 *   'users'
 * );
 * // Returns: ['users:read:all', 'users:update:all']
 * ```
 */
export function filterPermissionsByResource(permissions: string[], resource: string): string[] {
  return permissions.filter((perm) => {
    if (perm === WILDCARD_PERMISSION) return false;
    const parts = perm.split(':');
    return parts[0] === resource;
  });
}

/**
 * Parse a permission string into its components.
 *
 * @param permission - Permission string to parse
 * @returns Object with resource, action, and scope (if present)
 *
 * @example
 * ```typescript
 * parsePermission('users:read:all');
 * // Returns: { resource: 'users', action: 'read', scope: 'all' }
 *
 * parsePermission('profile:update:own');
 * // Returns: { resource: 'profile', action: 'update', scope: 'own' }
 *
 * parsePermission('*');
 * // Returns: { resource: '*', action: '*', scope: undefined }
 * ```
 */
export function parsePermission(permission: string): {
  resource: string;
  action: string;
  scope?: string | undefined;
} | null {
  if (permission === WILDCARD_PERMISSION) {
    return {
      resource: '*',
      action: '*',
      scope: undefined,
    };
  }

  const [resource, action, scope] = permission.split(':');
  if (resource === undefined || action === undefined) {
    return null;
  }

  return {
    resource,
    action,
    scope,
  };
}
