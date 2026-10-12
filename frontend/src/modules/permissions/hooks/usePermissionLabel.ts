'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { PERMISSION_ACTIONS, PERMISSION_SCOPES, parsePermission } from '@app/core';

/** Turns a permission string such as `users:read:all` into a label in the active locale. */
export type PermissionLabelFormatter = (permission: string) => string;

const ACTIONS: readonly string[] = PERMISSION_ACTIONS;
const SCOPES: readonly string[] = PERMISSION_SCOPES;

/**
 * Builds the label shown next to a permission checkbox.
 *
 * The raw permission stays visible underneath the label, so a segment without a
 * translation falls back to the segment itself rather than to English prose.
 *
 * @example
 * ```tsx
 * const formatPermissionLabel = usePermissionLabel();
 * formatPermissionLabel('users:read:all'); // "Read (all)"
 * ```
 */
export function usePermissionLabel(): PermissionLabelFormatter {
  const t = useTranslations('permissions');

  return useCallback(
    (permission: string): string => {
      const parsed = parsePermission(permission);
      if (!parsed) return permission;

      const { action, scope } = parsed;
      const actionLabel = ACTIONS.includes(action) ? t(`actions.${action}`) : action;
      if (!scope) return actionLabel;

      const scopeLabel = SCOPES.includes(scope) ? t(`scopes.${scope}`) : scope;
      return t('permissionLabelWithScope', { action: actionLabel, scope: scopeLabel });
    },
    [t],
  );
}
