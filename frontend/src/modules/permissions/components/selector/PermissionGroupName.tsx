import { usePermissionGroupName } from '../../hooks/usePermissionGroupName';
import type { PermissionGroup } from '../../types/permissionGroup.types';

/** A group's catalogue name, or its resource key kept left to right. */
export function PermissionGroupName({ group }: { group: PermissionGroup }) {
  const groupName = usePermissionGroupName();

  if (group.hasCatalogName) return groupName(group);
  return <span dir="ltr">{group.id}</span>;
}
