/**
 * Comprehensive permission constants for the RBAC system.
 * Format: resource:action[:scope]
 *
 * Resources: profile, users, roles, permissions, sessions, reports
 * Actions: read, create, update, delete, list, manage
 * Scopes: own, all, team (optional)
 */

// ========== Profile Permissions ==========
export const PROFILE_PERMISSIONS = {
  READ_OWN: 'profile:read:own',
  UPDATE_OWN: 'profile:update:own',
  DELETE_OWN: 'profile:delete:own',
} as const;

// ========== User Management Permissions ==========
export const USER_PERMISSIONS = {
  READ_ALL: 'users:read:all',
  LIST_ALL: 'users:list:all',
  CREATE_ALL: 'users:create:all',
  UPDATE_ALL: 'users:update:all',
  DELETE_ALL: 'users:delete:all',
  UPDATE_OWN: 'users:update:own',
} as const;

// ========== Role Management Permissions ==========
export const ROLE_PERMISSIONS = {
  READ_ALL: 'roles:read:all',
  LIST_ALL: 'roles:list:all',
  CREATE_ALL: 'roles:create:all',
  UPDATE_ALL: 'roles:update:all',
  DELETE_ALL: 'roles:delete:all',
  MANAGE_ALL: 'roles:manage:all',
} as const;

// ========== Permission Management Permissions ==========
export const PERMISSION_PERMISSIONS = {
  READ_ALL: 'permissions:read:all',
  GRANT_ALL: 'permissions:grant:all',
  REVOKE_ALL: 'permissions:revoke:all',
  MANAGE_ALL: 'permissions:manage:all',
} as const;

// ========== Session Management Permissions ==========
export const SESSION_PERMISSIONS = {
  READ_ALL: 'sessions:read:all',
  READ_OWN: 'sessions:read:own',
  READ_STAFF: 'sessions:read:staff',
  DELETE_ALL: 'sessions:delete:all',
  DELETE_OWN: 'sessions:delete:own',
  DELETE_STAFF: 'sessions:delete:staff',
} as const;

// ========== Report Permissions ==========
export const REPORT_PERMISSIONS = {
  READ_ALL: 'reports:read:all',
  CREATE_ALL: 'reports:create:all',
} as const;

export const ACTIVITY_PERMISSIONS = {
  READ_ALL: 'activity:read:all',
} as const;

// ========== Wildcard Permission ==========
/**
 * Wildcard permission grants all access.
 * Should only be assigned to super admin users.
 */
export const WILDCARD_PERMISSION = '*' as const;

// ========== All Permissions Array ==========
export const ALL_PERMISSIONS = [
  WILDCARD_PERMISSION,
  ...Object.values(PROFILE_PERMISSIONS),
  ...Object.values(USER_PERMISSIONS),
  ...Object.values(ROLE_PERMISSIONS),
  ...Object.values(PERMISSION_PERMISSIONS),
  ...Object.values(SESSION_PERMISSIONS),
  ...Object.values(REPORT_PERMISSIONS),
  ...Object.values(ACTIVITY_PERMISSIONS),
] as const;

/**
 * Type for all valid permissions
 */
export type Permission = (typeof ALL_PERMISSIONS)[number];

// ========== Label Segments ==========
/**
 * Action segments that have a translated label under permissions.actions.
 * Anything outside this list falls back to the raw segment.
 */
export const PERMISSION_ACTIONS = [
  'read',
  'list',
  'create',
  'update',
  'delete',
  'manage',
  'grant',
  'revoke',
] as const;

/**
 * Scope segments that have a translated label under permissions.scopes.
 */
export const PERMISSION_SCOPES = ['own', 'all', 'staff'] as const;

/**
 * Outside the active catalogue and picker. The permission format accepts these,
 * but grant validation refuses them until their plan.
 */
export const RESERVED_PERMISSIONS = [
  'users:list:staff',
  'users:read:staff',
  'users:update:staff',
  'users:delete:staff',
  'users:create:staff',
  'users:suspend:all',
  'users:suspend:staff',
] as const;
