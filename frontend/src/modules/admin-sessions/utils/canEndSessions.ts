import { ROLE_AUDIENCE, SESSION_PERMISSIONS, hasPermission, type RoleAudience } from '@app/core';

export function canEndSessions(
  permissions: string[],
  targetClass: RoleAudience | undefined,
): boolean {
  return (
    hasPermission(permissions, SESSION_PERMISSIONS.DELETE_ALL) &&
    (targetClass === ROLE_AUDIENCE.CUSTOMER ||
      (targetClass === ROLE_AUDIENCE.STAFF &&
        hasPermission(permissions, SESSION_PERMISSIONS.DELETE_STAFF)))
  );
}
