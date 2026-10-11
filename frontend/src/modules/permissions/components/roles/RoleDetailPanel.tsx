'use client';

import { Description, Heading } from '@/components/design-system';
import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { PermissionTreeView } from '../permission-tree/PermissionTreeView';
import { Pencil, Trash2, Shield, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Role } from '../../api/rolesApi';

export interface RoleDetailPanelProps {
  /**
   * Role to display
   */
  role: Role | null;

  /**
   * Callback when edit button is clicked
   */
  onEdit?: (role: Role) => void;

  /**
   * Callback when delete button is clicked
   */
  onDelete?: (role: Role) => void;

  /**
   * Loading state
   */
  isLoading?: boolean;

  /**
   * Optional className
   */
  className?: string;
}

/**
 * RoleDetailPanel - Detailed view of a selected role
 *
 * Features:
 * - Large header with role name and badges
 * - Description section
 * - Permission tree visualization
 * - Action buttons (Edit/Delete)
 * - Protected role warnings
 * - Minimal aesthetic with refined spacing
 *
 * @example
 * ```tsx
 * <RoleDetailPanel
 *   role={selectedRole}
 *   onEdit={handleEdit}
 *   onDelete={handleDelete}
 * />
 * ```
 */
export const RoleDetailPanel = memo(function RoleDetailPanel({
  role,
  onEdit,
  onDelete,
  isLoading = false,
  className,
}: RoleDetailPanelProps) {
  const t = useTranslations('roles.detail');

  if (isLoading) {
    return (
      <div className={cn('animate-pulse space-y-6', className)}>
        <div className="h-8 bg-muted/20 rounded w-1/3" />
        <div className="h-4 bg-muted/20 rounded w-2/3" />
        <div className="h-24 bg-muted/20 rounded" />
      </div>
    );
  }

  if (!role) {
    return (
      <div className={cn('flex items-center justify-center py-16 text-center', className)}>
        <div className="space-y-3">
          <Shield className="h-12 w-12 mx-auto text-muted-foreground" aria-hidden="true" />
          <Heading level={2} variant="sectionTitle">
            {t('noRoleSelected')}
          </Heading>
          <Description className="max-w-sm">{t('selectRoleHint')}</Description>
        </div>
      </div>
    );
  }

  // Check if role is user or admin (cannot be edited)
  const isBaseRole = role.slug === 'user' || role.slug === 'admin';

  return (
    <article className={cn('space-y-6', className)} data-testid="role-detail-panel">
      {/* Header */}
      <header className="pb-4 border-b border-border">
        <div className="flex items-start justify-between mb-2">
          <div className="min-w-0 flex-1">
            <Heading level={2} variant="sectionTitle" className="break-words">
              <span dir="auto" data-testid="role-detail-name">
                {role.name}
              </span>
            </Heading>
            <Description className="mt-1">
              <span dir="ltr" data-testid="role-detail-slug">
                {role.slug}
              </span>
            </Description>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {role.isSystemRole && (
              <Badge variant="outline" className="text-xs">
                <Shield className="h-3 w-3 me-1" aria-hidden="true" />
                {t('systemBadge')}
              </Badge>
            )}
            {role.isProtected && (
              <Badge variant="secondary" className="text-xs">
                <Lock className="h-3 w-3 me-1" aria-hidden="true" />
                {t('protectedBadge')}
              </Badge>
            )}
          </div>
        </div>
      </header>

      {/* Description */}
      {role.description && (
        <section>
          <Description>
            <span dir="auto" data-testid="role-detail-description">
              {role.description}
            </span>
          </Description>
        </section>
      )}

      {/* Permissions Section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <Heading level={3} variant="eyebrow">
            {t('permissionsHeading', { count: role.permissions.length })}
          </Heading>
          {role.permissions.includes('*') && (
            <Badge
              variant="outline"
              className="text-xs text-status-warning border-status-warning/30"
            >
              {t('wildcardBadge')}
            </Badge>
          )}
        </div>
        <PermissionTreeView permissions={role.permissions} variant="default" showHeaders />
      </section>

      {/* Actions */}
      <footer className="flex gap-2 pt-4 border-t border-border">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onEdit?.(role)}
          disabled={isBaseRole}
          data-testid="edit-role-button"
        >
          <Pencil className="h-3 w-3 me-2" aria-hidden="true" />
          {t('editRole')}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => onDelete?.(role)}
          disabled={role.isProtected}
          data-testid="delete-role-button"
        >
          <Trash2 className="h-3 w-3 me-2" aria-hidden="true" />
          {t('deleteRole')}
        </Button>
      </footer>

      {/* Base Role Notice */}
      {isBaseRole && (
        <Alert variant="infoSoft" role="note" className="p-3">
          <AlertDescription className="text-xs">
            <strong>{t('baseRoleNoticeTitle')}</strong> {t('baseRoleNotice')}
          </AlertDescription>
        </Alert>
      )}

      {/* Protected Notice */}
      {role.isProtected && !isBaseRole && (
        <Alert variant="warningSoft" role="note" className="p-3">
          <AlertDescription className="text-xs">
            <strong>{t('protectedRoleNoticeTitle')}</strong> {t('protectedRoleNotice')}
          </AlertDescription>
        </Alert>
      )}
    </article>
  );
});
