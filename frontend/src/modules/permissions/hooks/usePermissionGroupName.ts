'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { PermissionGroup } from '../types/permissionGroup.types';

/** Names a permission group in the active locale. */
export type PermissionGroupNamer = (group: PermissionGroup) => string;

/**
 * Names a permission group from the catalogue. A host resource the catalogue
 * does not name falls back to the resource itself, as permission labels fall
 * back to their raw segment.
 */
export function usePermissionGroupName(): PermissionGroupNamer {
  const t = useTranslations('permissions.selector');

  return useCallback(
    (group: PermissionGroup): string => (group.hasCatalogName ? t(`groups.${group.id}`) : group.id),
    [t],
  );
}
