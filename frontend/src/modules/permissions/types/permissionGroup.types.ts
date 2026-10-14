export interface PermissionGroup {
  /** Tab value, and the resource part of every permission in the group */
  id: string;
  /** Whether permissions.selector.groups has a name for this group */
  hasCatalogName: boolean;
  permissions: Record<string, string>;
}
