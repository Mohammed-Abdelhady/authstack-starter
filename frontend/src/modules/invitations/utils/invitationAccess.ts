import { hasAnyPermission, hasPermission, ROLE_AUDIENCE, USER_PERMISSIONS } from '@app/core';
import type { RoleAudience } from '@app/core';
import { ADMIN_ROLE_SLUG } from '@/modules/roles/constants';
import type { AllRoles } from '@/modules/roles/hooks/useAllRoles';
import type { InvitationRole } from '../types/invitation.types';

export function invitationAccess(permissions: string[]) {
  const createAll = hasPermission(permissions, USER_PERMISSIONS.CREATE_ALL);
  const createStaff = hasPermission(permissions, USER_PERMISSIONS.CREATE_STAFF);

  return {
    canList: hasAnyPermission(permissions, [
      USER_PERMISSIONS.LIST_ALL,
      USER_PERMISSIONS.LIST_STAFF,
    ]),
    canCreate: createAll || createStaff,
    canManage: (audience?: RoleAudience) =>
      createAll || (createStaff && audience === ROLE_AUDIENCE.STAFF),
  };
}

export function invitationRoles(
  allRoles: AllRoles,
  actorRole: string | undefined,
  permissions: string[],
): AllRoles {
  const access = invitationAccess(permissions);
  const roles: InvitationRole[] = allRoles.roles;

  return {
    ...allRoles,
    roles: roles.filter((role) => access.canManage(role.audience)),
    refusalFor: (role) =>
      actorRole === ADMIN_ROLE_SLUG && role.slug === ADMIN_ROLE_SLUG
        ? null
        : allRoles.refusalFor(role),
  };
}
