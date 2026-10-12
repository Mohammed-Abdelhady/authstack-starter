import {
  PROFILE_PERMISSIONS,
  USER_PERMISSIONS,
  ROLE_PERMISSIONS,
  PERMISSION_PERMISSIONS,
  SESSION_PERMISSIONS,
  REPORT_PERMISSIONS,
} from '@app/core';

export interface PermissionGroup {
  /** Tab value and key of the group name under permissions.selector.groups */
  id: string;
  permissions: Record<string, string>;
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  { id: 'profile', permissions: PROFILE_PERMISSIONS },
  { id: 'users', permissions: USER_PERMISSIONS },
  { id: 'roles', permissions: ROLE_PERMISSIONS },
  { id: 'permissions', permissions: PERMISSION_PERMISSIONS },
  { id: 'sessions', permissions: SESSION_PERMISSIONS },
  { id: 'reports', permissions: REPORT_PERMISSIONS },
];
