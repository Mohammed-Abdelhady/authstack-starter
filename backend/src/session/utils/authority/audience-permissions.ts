import {
  PERMISSION_SCOPES,
  WILDCARD_PERMISSION,
} from '../../../common/constants/permissions';

export function permissionsRequireStaff(
  permissions: readonly string[],
): boolean {
  return permissions.some(
    (permission) =>
      permission === WILDCARD_PERMISSION ||
      permission.endsWith(`:${PERMISSION_SCOPES.STAFF}`),
  );
}
