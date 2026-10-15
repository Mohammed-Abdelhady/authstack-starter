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
  DELETE_ALL: 'sessions:delete:all',
  DELETE_OWN: 'sessions:delete:own',
} as const;

// ========== Report Permissions ==========
export const REPORT_PERMISSIONS = {
  READ_ALL: 'reports:read:all',
  CREATE_ALL: 'reports:create:all',
} as const;

// ========== Wildcard Permission ==========
/**
 * Wildcard permission grants all access.
 * Should only be assigned to super admin users.
 */
export const WILDCARD_PERMISSION = '*' as const;

// ========== Permission Categories ==========
export const PERMISSION_CATEGORIES = {
  PROFILE: 'profile',
  USERS: 'users',
  ROLES: 'roles',
  PERMISSIONS: 'permissions',
  SESSIONS: 'sessions',
  REPORTS: 'reports',
} as const;

// ========== Permission Actions ==========
export const PERMISSION_ACTIONS = {
  READ: 'read',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  MANAGE: 'manage',
  GRANT: 'grant',
  REVOKE: 'revoke',
} as const;

// ========== Permission Scopes ==========
export const PERMISSION_SCOPES = {
  OWN: 'own',
  ALL: 'all',
  TEAM: 'team',
} as const;

// ========== All Permissions Array (for validation) ==========
export const ALL_PERMISSIONS = [
  WILDCARD_PERMISSION,
  ...Object.values(PROFILE_PERMISSIONS),
  ...Object.values(USER_PERMISSIONS),
  ...Object.values(ROLE_PERMISSIONS),
  ...Object.values(PERMISSION_PERMISSIONS),
  ...Object.values(SESSION_PERMISSIONS),
  ...Object.values(REPORT_PERMISSIONS),
] as const;

/**
 * Default permissions for system roles.
 * These are used during role seeding and user creation.
 */
export const DEFAULT_ROLE_PERMISSIONS = {
  user: [PROFILE_PERMISSIONS.READ_OWN, PROFILE_PERMISSIONS.UPDATE_OWN],
  support: [
    PROFILE_PERMISSIONS.READ_OWN,
    PROFILE_PERMISSIONS.UPDATE_OWN,
    USER_PERMISSIONS.READ_ALL,
    SESSION_PERMISSIONS.READ_ALL,
  ],
  manager: [
    PROFILE_PERMISSIONS.READ_OWN,
    PROFILE_PERMISSIONS.UPDATE_OWN,
    USER_PERMISSIONS.READ_ALL,
    USER_PERMISSIONS.UPDATE_ALL,
    SESSION_PERMISSIONS.READ_ALL,
    ROLE_PERMISSIONS.READ_ALL,
  ],
  admin: [WILDCARD_PERMISSION],
} as const;

/**
 * Permission validation regex.
 * Matches: resource:action[:scope] or wildcard (*)
 */
export const PERMISSION_REGEX = /^([a-z-]+:[a-z-]+(:[a-z-]+)?|\*)$/;

/**
 * Type definition for all valid permissions
 */
export type Permission = (typeof ALL_PERMISSIONS)[number];

/**
 * Type definition for permission categories
 */
export type PermissionCategory =
  (typeof PERMISSION_CATEGORIES)[keyof typeof PERMISSION_CATEGORIES];

/**
 * Type definition for permission actions
 */
export type PermissionAction =
  (typeof PERMISSION_ACTIONS)[keyof typeof PERMISSION_ACTIONS];

/**
 * Type definition for permission scopes
 */
export type PermissionScope =
  (typeof PERMISSION_SCOPES)[keyof typeof PERMISSION_SCOPES];

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
  'activity:read:all',
  'sessions:read:staff',
  'sessions:delete:staff',
] as const;

export const RESERVED_PERMISSION_MESSAGE =
  '$value is reserved and cannot be granted yet';
