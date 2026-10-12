'use client';

import { Heading } from '@/components/design-system';
import { useTranslations } from 'next-intl';
import { busyPressProps } from '@/components/ui/busy';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchPermissionGrid } from './SearchPermissionGrid';
import { PERMISSION_GROUPS } from '../../constants/permissionGroups';
import type { PermissionGroup } from '../../types/permissionGroup.types';

export interface FilteredPermissionGroup extends PermissionGroup {
  filteredPermissions: Record<string, string>;
}

export interface SearchPermissionTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  filteredGroups: FilteredPermissionGroup[];
  selectedPermissions: string[];
  onSelectAll: (permissions: Record<string, string>) => void;
  onTogglePermission: (permission: string) => void;
  isLoading?: boolean;
  searchQuery: string;
}

export function SearchPermissionTabs({
  activeTab,
  onTabChange,
  filteredGroups,
  selectedPermissions,
  onSelectAll,
  onTogglePermission,
  isLoading = false,
  searchQuery,
}: SearchPermissionTabsProps) {
  const t = useTranslations('permissions.selector');
  const tDialog = useTranslations('permissions.searchDialog');

  return (
    <Tabs
      value={activeTab}
      onValueChange={onTabChange}
      className="flex-1 flex flex-col overflow-hidden"
    >
      <div className="w-full overflow-x-auto pb-1">
        <TabsList className="inline-flex w-max min-w-full justify-start flex-nowrap">
          <TabsTrigger value="all" className="shrink-0" data-testid="permission-tab-all">
            {t('allTab')}
          </TabsTrigger>
          {PERMISSION_GROUPS.map((group) => (
            <TabsTrigger
              key={group.id}
              value={group.id}
              className="shrink-0"
              data-testid={`permission-tab-${group.id}`}
            >
              {t(`groups.${group.id}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {/* All Permissions Tab */}
      <TabsContent value="all" className="flex-1 overflow-y-auto mt-4 space-y-6">
        {filteredGroups.map((group) => {
          const groupPerms = Object.values(group.filteredPermissions);
          const allSelected = groupPerms.every((p) => selectedPermissions.includes(p));

          return (
            <div key={group.id} className="space-y-3">
              <div className="flex items-center justify-between">
                <Heading level={3} variant="subsectionTitle">
                  {t(`groups.${group.id}`)}
                </Heading>
                <button
                  type="button"
                  disabled={groupPerms.length === 0}
                  {...busyPressProps(isLoading, () => onSelectAll(group.filteredPermissions))}
                  aria-label={t(allSelected ? 'deselectAllForGroup' : 'selectAllForGroup', {
                    group: t(`groups.${group.id}`),
                  })}
                  className="min-h-6 text-xs text-primary hover:underline disabled:opacity-50 aria-disabled:cursor-progress aria-disabled:opacity-85"
                  data-testid={`select-all-${group.id}`}
                >
                  {allSelected ? t('deselectAll') : t('selectAll')}
                </button>
              </div>

              <SearchPermissionGrid
                permissions={group.filteredPermissions}
                selectedPermissions={selectedPermissions}
                onTogglePermission={onTogglePermission}
                isLoading={isLoading}
              />
            </div>
          );
        })}

        {filteredGroups.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            {tDialog('noPermissionsMatch', { query: searchQuery })}
          </div>
        )}
      </TabsContent>

      {/* Individual Category Tabs */}
      {PERMISSION_GROUPS.map((group) => {
        const filtered = filteredGroups.find((g) => g.id === group.id);
        const groupPerms = filtered ? Object.values(filtered.filteredPermissions) : [];
        const allSelected = groupPerms.every((p) => selectedPermissions.includes(p));
        const category = t(`groups.${group.id}`);

        return (
          <TabsContent
            key={group.id}
            value={group.id}
            className="flex-1 overflow-y-auto mt-4 space-y-4"
          >
            {filtered && groupPerms.length > 0 ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {t('permissionsAvailable', { count: groupPerms.length })}
                  </p>
                  <button
                    type="button"
                    {...busyPressProps(isLoading, () => onSelectAll(filtered.filteredPermissions))}
                    aria-label={t(allSelected ? 'deselectAllForGroup' : 'selectAllForGroup', {
                      group: category,
                    })}
                    className="min-h-6 text-xs text-primary hover:underline aria-disabled:cursor-progress aria-disabled:opacity-85"
                    data-testid={`select-all-tab-${group.id}`}
                  >
                    {allSelected ? t('deselectAll') : t('selectAll')}
                  </button>
                </div>

                <SearchPermissionGrid
                  permissions={filtered.filteredPermissions}
                  selectedPermissions={selectedPermissions}
                  onTogglePermission={onTogglePermission}
                  isLoading={isLoading}
                />
              </>
            ) : (
              <div className="text-center py-12 text-sm text-muted-foreground">
                {searchQuery
                  ? tDialog('noCategoryPermissionsMatch', { category, query: searchQuery })
                  : tDialog('categoryAllAssigned', { category })}
              </div>
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
