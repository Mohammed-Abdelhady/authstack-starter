import { ALL_PERMISSIONS, HOST_PERMISSIONS, WILDCARD_PERMISSION, parsePermission } from '@app/core';
import type { PermissionGroup } from '../types/permissionGroup.types';

/** The core resources in picker order, each named under permissions.selector.groups. */
export const CORE_PERMISSION_GROUP_IDS = [
  'profile',
  'users',
  'roles',
  'permissions',
  'sessions',
  'reports',
] as const;

const NAMED_GROUP_IDS: readonly string[] = CORE_PERMISSION_GROUP_IDS;

/** Tab value of the tab that lists every group, in both pickers. */
export const ALL_GROUPS_TAB = 'all';

/**
 * Tab value of one group. Namespaced, and a resource holds no `:`, so a host
 * resource named `all` cannot take the value of the tab that lists every group.
 */
export function permissionGroupTab(groupId: string): string {
  return `group:${groupId}`;
}

/**
 * Groups the core and host permissions by their resource part. The core groups
 * come first in their own order, then each other resource in the order it
 * first appears.
 */
export function buildPermissionGroups(
  corePermissions: readonly string[],
  hostPermissions: readonly string[],
): PermissionGroup[] {
  const byResource = new Map<string, Record<string, string>>(
    CORE_PERMISSION_GROUP_IDS.map((id) => [id, {}]),
  );
  for (const permission of [...corePermissions, ...hostPermissions]) {
    const parsed = parsePermission(permission);
    if (!parsed || permission === WILDCARD_PERMISSION) continue;
    const group = byResource.get(parsed.resource) ?? {};
    group[permission] = permission;
    byResource.set(parsed.resource, group);
  }
  return [...byResource]
    .filter(([, group]) => Object.keys(group).length > 0)
    .map(([id, group]) => ({
      id,
      hasCatalogName: NAMED_GROUP_IDS.includes(id),
      permissions: group,
    }));
}

export const PERMISSION_GROUPS: PermissionGroup[] = buildPermissionGroups(
  ALL_PERMISSIONS,
  HOST_PERMISSIONS,
);
