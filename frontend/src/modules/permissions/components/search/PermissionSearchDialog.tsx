'use client';

import { useState, useMemo, useCallback, memo } from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { SearchBar } from '@/components/design-system';
import { Plus, Shield } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { FormRootError } from '@/components/forms';
import { WILDCARD_PERMISSION } from '@app/core';
import { FREE_TEXT_SEARCH_CLASSES } from '@/constants/freeText';
import { MAX_ADMIN_SEARCH_LENGTH } from '../../constants/search';
import { usePermissionLabel } from '../../hooks/usePermissionLabel';
import { SearchPermissionTabs } from './SearchPermissionTabs';
import { ALL_GROUPS_TAB, PERMISSION_GROUPS } from '../../constants/permissionGroups';

export interface PermissionSearchDialogProps {
  /**
   * Whether the dialog is open
   */
  open: boolean;

  /**
   * Callback when dialog should close
   */
  onOpenChange: (open: boolean) => void;

  /**
   * Currently selected permissions
   */
  selectedPermissions: string[];

  /**
   * Callback when permissions change
   */
  onChange: (permissions: string[]) => void;

  /**
   * Permissions to exclude from selection (already assigned)
   */
  excludedPermissions?: string[];

  /**
   * Whether to show the wildcard permission option
   */
  showWildcard?: boolean;

  /**
   * Whether the dialog is in loading state
   */
  isLoading?: boolean;

  /**
   * Callback when confirm button is clicked
   */
  onConfirm?: () => void;

  /**
   * Why the last confirm was refused, said above the buttons
   */
  refusal?: string | null;
}

/**
 * PermissionSearchDialog - Advanced permission selection dialog
 *
 * Features:
 * - Search across all permissions
 * - Category tabs for organized browsing
 * - Bulk selection per category
 * - Wildcard permission option
 * - Excludes already assigned permissions
 * - Minimal & refined design
 *
 * @example
 * ```tsx
 * <PermissionSearchDialog
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   selectedPermissions={selected}
 *   onChange={setSelected}
 *   excludedPermissions={existingPermissions}
 *   onConfirm={handleAdd}
 * />
 * ```
 */
export const PermissionSearchDialog = memo(function PermissionSearchDialog({
  open,
  onOpenChange,
  selectedPermissions,
  onChange,
  excludedPermissions = [],
  showWildcard = true,
  isLoading = false,
  onConfirm,
  refusal,
}: PermissionSearchDialogProps) {
  const t = useTranslations('permissions.searchDialog');
  const tSelector = useTranslations('permissions.selector');
  const formatPermissionLabel = usePermissionLabel();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState(ALL_GROUPS_TAB);

  const handleTogglePermission = useCallback(
    (permission: string) => {
      const isSelected = selectedPermissions.includes(permission);

      if (isSelected) {
        onChange(selectedPermissions.filter((p) => p !== permission));
      } else {
        onChange([...selectedPermissions, permission]);
      }
    },
    [selectedPermissions, onChange],
  );

  const handleToggleWildcard = useCallback(() => {
    const hasWildcard = selectedPermissions.includes(WILDCARD_PERMISSION);

    if (hasWildcard) {
      onChange(selectedPermissions.filter((p) => p !== WILDCARD_PERMISSION));
    } else {
      onChange([WILDCARD_PERMISSION]);
    }
  }, [selectedPermissions, onChange]);

  const handleSelectAll = useCallback(
    (groupPermissions: Record<string, string>) => {
      const groupPerms = Object.values(groupPermissions).filter(
        (p) => !excludedPermissions.includes(p),
      );
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
    [selectedPermissions, excludedPermissions, onChange],
  );

  // Filter permissions by search query and tab
  const filteredGroups = useMemo(() => {
    const query = searchQuery.toLowerCase();

    return PERMISSION_GROUPS.map((group) => {
      const filteredPermissions = Object.entries(group.permissions).filter(([, perm]) => {
        // Exclude already assigned permissions
        if (excludedPermissions.includes(perm)) return false;

        // Filter by search query
        if (query && !perm.toLowerCase().includes(query)) {
          const label = formatPermissionLabel(perm).toLowerCase();
          if (!label.includes(query)) return false;
        }

        return true;
      });

      return {
        ...group,
        filteredPermissions: Object.fromEntries(filteredPermissions),
      };
    }).filter((group) => Object.keys(group.filteredPermissions).length > 0);
  }, [searchQuery, excludedPermissions, formatPermissionLabel]);

  const hasWildcard = selectedPermissions.includes(WILDCARD_PERMISSION);
  const availableCount = selectedPermissions.filter((p) => !excludedPermissions.includes(p)).length;

  return (
    <Dialog open={open} busy={isLoading} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-4xl overflow-hidden flex flex-col"
        data-testid="permission-search-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Search Bar */}
          <SearchBar
            className={FREE_TEXT_SEARCH_CLASSES}
            aria-label={t('searchLabel')}
            placeholder={t('searchPlaceholder')}
            maxLength={MAX_ADMIN_SEARCH_LENGTH}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value.slice(0, MAX_ADMIN_SEARCH_LENGTH))}
            onClear={() => setSearchQuery('')}
            showClear={searchQuery.length > 0}
            data-testid="permission-search-input"
          />

          {/* Wildcard Option */}
          {showWildcard && (
            <Alert variant="warningSoft" role="note">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="wildcard-permission"
                  checked={hasWildcard}
                  onCheckedChange={handleToggleWildcard}
                  busy={isLoading}
                  data-testid="wildcard-permission-checkbox"
                />
                <div className="flex-1">
                  <Label
                    htmlFor="wildcard-permission"
                    className="font-semibold text-foreground flex items-center gap-2"
                  >
                    {/* Decorative: the title beside it says what the box is about. */}
                    <Shield className="h-4 w-4 text-status-warning" aria-hidden="true" />
                    {tSelector('wildcardTitle')}
                  </Label>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {tSelector('wildcardDescription')}
                  </p>
                </div>
              </div>
            </Alert>
          )}

          {/* Category Tabs */}
          {!hasWildcard && (
            <SearchPermissionTabs
              activeTab={activeTab}
              onTabChange={setActiveTab}
              filteredGroups={filteredGroups}
              selectedPermissions={selectedPermissions}
              onSelectAll={handleSelectAll}
              onTogglePermission={handleTogglePermission}
              isLoading={isLoading}
              searchQuery={searchQuery}
            />
          )}

          {/* Wildcard Notice */}
          {hasWildcard && (
            <div className="rounded-lg border border-border bg-muted p-4 text-center">
              <p className="text-sm text-muted-foreground">{tSelector('wildcardNotice')}</p>
            </div>
          )}
        </div>

        <FormRootError error={refusal} className="mb-0" testId="add-permissions-error" />

        {/* Footer with Selection Summary and Confirm Button */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <div className="text-sm text-muted-foreground">
            {hasWildcard ? (
              <span>{t('allGrantedWildcard')}</span>
            ) : (
              <span>{t('selectedCount', { count: availableCount })}</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              busy={isLoading}
              data-testid="cancel-add-permissions"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={onConfirm}
              disabled={availableCount === 0}
              busy={isLoading}
              aria-busy={isLoading}
              data-testid="confirm-add-permissions"
            >
              <Plus className="me-2 h-4 w-4" aria-hidden="true" />
              {t('addCount', { count: availableCount })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});
