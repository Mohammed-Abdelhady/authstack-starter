export interface PermissionGroup {
  /** Tab value and key of the group name under permissions.selector.groups */
  id: string;
  permissions: Record<string, string>;
}
