'use client';

import { Heading } from '@/components/design-system';
import { useState, useMemo, useCallback, memo } from 'react';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { busyPressProps } from '@/components/ui/busy';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WILDCARD_PERMISSION } from '@app/core';

import { PermissionGroupGrid } from './PermissionGroupGrid';
import { PERMISSION_GROUPS } from '../../constants/permissionGroups';

export interface PermissionSelectorProps {
  /**
   * Currently selected permissions
   */
  selectedPermissions: string[];

  /**
   * Callback when permissions change
   */
  onChange: (permissions: string[]) => void;

  /**
   * The request of the form around it is running: its controls keep focus and
   * cannot be changed.
   */
  busy?: boolean;

  /**
   * Whether to show the wildcard permission option
   * Default: true
   */
  showWildcard?: boolean;
}

/**
 * Component for selecting permissions.
 * Organizes permissions by resource category with checkboxes.
 */
export const PermissionSelector = memo(function PermissionSelector({
  selectedPermissions,
  onChange,
  busy = false,
  showWildcard = true,
}: PermissionSelectorProps) {
  const t = useTranslations('permissions.selector');
  const [activeTab, setActiveTab] = useState('all');
  const handleTogglePermission = useCallback(
    (permission: string) => {
      if (busy) return;

      const isSelected = selectedPermissions.includes(permission);

      if (isSelected) {
        onChange(selectedPermissions.filter((p) => p !== permission));
      } else {
        onChange([...selectedPermissions, permission]);
      }
    },
    [busy, selectedPermissions, onChange],
  );

  const handleToggleWildcard = useCallback(() => {
    if (busy) return;

    const hasWildcard = selectedPermissions.includes(WILDCARD_PERMISSION);

    if (hasWildcard) {
      onChange(selectedPermissions.filter((p) => p !== WILDCARD_PERMISSION));
    } else {
      onChange([WILDCARD_PERMISSION]);
    }
  }, [busy, selectedPermissions, onChange]);

  const handleSelectAll = useCallback(
    (groupPermissions: Record<string, string>) => {
      if (busy) return;

      const groupPerms = Object.values(groupPermissions);
      const allSelected = groupPerms.every((p) => selectedPermissions.includes(p));

      if (allSelected) {
        onChange(selectedPermissions.filter((p) => !groupPerms.includes(p)));
      } else {
        const newPermissions = [...selectedPermissions];
        groupPerms.forEach((p) => {
          if (!newPermissions.includes(p)) {
            newPermissions.push(p);
          }
        });
        onChange(newPermissions);
      }
    },
    [busy, selectedPermissions, onChange],
  );

  const hasWildcard = selectedPermissions.includes(WILDCARD_PERMISSION);

  const groupStats = useMemo(() => {
    const stats: Record<string, number> = {};
    PERMISSION_GROUPS.forEach((group) => {
      const groupPerms = Object.values(group.permissions);
      stats[group.id] = groupPerms.filter((p) => selectedPermissions.includes(p)).length;
    });
    return stats;
  }, [selectedPermissions]);

  return (
    <div className="space-y-4">
      {/* Wildcard Permission */}
      {showWildcard && (
        <Alert variant="warningSoft" role="note">
          <div className="flex items-start gap-3">
            <Checkbox
              id="wildcard-permission"
              checked={hasWildcard}
              onCheckedChange={handleToggleWildcard}
              busy={busy}
              data-testid="wildcard-permission-checkbox"
            />
            <div className="flex-1">
              <Label htmlFor="wildcard-permission" className="font-semibold text-inherit">
                {t('wildcardTitle')}
              </Label>
              <p className="mt-1 text-sm text-muted-foreground">{t('wildcardDescription')}</p>
            </div>
          </div>
        </Alert>
      )}

      {/* Tabbed Permission Groups */}
      {!hasWildcard && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="w-full overflow-x-auto pb-1">
            <TabsList className="inline-flex w-max min-w-full justify-start flex-nowrap">
              <TabsTrigger
                value="all"
                className="text-xs shrink-0"
                data-testid="permission-group-tab-all"
              >
                {t('allTab')}
                {selectedPermissions.length > 0 && (
                  <span className="ms-1 rounded-full bg-secondary text-primary px-1.5 py-0.5 text-[10px]">
                    {selectedPermissions.length}
                  </span>
                )}
              </TabsTrigger>
              {PERMISSION_GROUPS.map((group) => (
                <TabsTrigger
                  key={group.id}
                  value={group.id}
                  className="text-xs shrink-0"
                  data-testid={`permission-group-tab-${group.id}`}
                >
                  {t(`groups.${group.id}`)}
                  {groupStats[group.id] > 0 && (
                    <span className="ms-1 rounded-full bg-secondary text-primary px-1.5 py-0.5 text-[10px]">
                      {groupStats[group.id]}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* All Permissions Tab */}
          <TabsContent value="all" className="mt-4 space-y-6">
            {PERMISSION_GROUPS.map((group) => {
              const groupPerms = Object.values(group.permissions);
              const allSelected = groupPerms.every((p) => selectedPermissions.includes(p));

              return (
                <div key={group.id} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Heading level={3} variant="subsectionTitle">
                      {t(`groups.${group.id}`)}
                    </Heading>
                    <button
                      type="button"
                      {...busyPressProps(busy, () => handleSelectAll(group.permissions))}
                      className="min-h-6 text-xs text-primary hover:underline aria-disabled:cursor-progress aria-disabled:opacity-85"
                      data-testid={`permission-group-select-all-${group.id}`}
                    >
                      {allSelected ? t('deselectAll') : t('selectAll')}
                    </button>
                  </div>

                  <PermissionGroupGrid
                    permissions={group.permissions}
                    selectedPermissions={selectedPermissions}
                    onTogglePermission={handleTogglePermission}
                    busy={busy}
                  />
                </div>
              );
            })}
          </TabsContent>

          {/* Individual Category Tabs */}
          {PERMISSION_GROUPS.map((group) => {
            const groupPerms = Object.values(group.permissions);
            const allSelected = groupPerms.every((p) => selectedPermissions.includes(p));

            return (
              <TabsContent key={group.id} value={group.id} className="mt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {t('permissionsAvailable', { count: groupPerms.length })}
                  </p>
                  <button
                    type="button"
                    {...busyPressProps(busy, () => handleSelectAll(group.permissions))}
                    className="min-h-6 text-xs text-primary hover:underline aria-disabled:cursor-progress aria-disabled:opacity-85"
                    data-testid={`permission-group-select-all-tab-${group.id}`}
                  >
                    {allSelected ? t('deselectAll') : t('selectAll')}
                  </button>
                </div>

                <PermissionGroupGrid
                  permissions={group.permissions}
                  selectedPermissions={selectedPermissions}
                  onTogglePermission={handleTogglePermission}
                  busy={busy}
                  prefix={group.id}
                />
              </TabsContent>
            );
          })}
        </Tabs>
      )}

      {/* Wildcard Notice */}
      {hasWildcard && (
        <div className="rounded-lg border border-border bg-muted p-4 text-center">
          <p className="text-sm text-muted-foreground">{t('wildcardNotice')}</p>
        </div>
      )}

      {/* Permission Count */}
      <div className="text-sm text-muted-foreground">
        {hasWildcard ? (
          <span>{t('wildcardSelected')}</span>
        ) : (
          <span>{t('permissionsSelected', { count: selectedPermissions.length })}</span>
        )}
      </div>
    </div>
  );
});
