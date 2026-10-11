'use client';

import { memo, useCallback } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Heading, StatusBadge } from '@/components/design-system';
import { UserRoleSelector } from './UserRoleSelector';
import { UserActionsMenu } from './UserActionsMenu';
import { UserRoleLabel } from './UserRoleLabel';
import { PermissionGuard } from '@/modules/permissions';
import { USER_PERMISSIONS } from '@app/core';
import { HOVER_REVEAL_CLASSES } from '@/constants/focusStyles';
import { cn } from '@/lib/utils';
import { getInitials, formatDateShort } from '@/lib/formatters';
import { useUserActions } from '../../hooks/useUserActions';

export interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
  isVerified: boolean;
  isDeleted: boolean;
  createdAt: string;
}

export interface UserCardProps {
  /** User data */
  user: User;
  /** Callback when manage permissions is clicked */
  onManagePermissions?: (userId: string, opener: HTMLElement | null) => void;
  /** Optional className */
  className?: string;
}

/**
 * UserCard - Minimal user card with refined aesthetic.
 *
 * Features:
 * - Avatar with initials fallback
 * - Hover-reveal actions via UserActionsMenu
 * - Role selector with permission guard
 * - Status badges (verified/pending, active/inactive)
 * - Optimized with React.memo
 *
 * @example
 * ```tsx
 * <UserCard
 *   user={user}
 *   onManagePermissions={(id) => openPermissionsDialog(id)}
 * />
 * ```
 */
export const UserCard = memo(
  function UserCard({ user, onManagePermissions, className }: UserCardProps) {
    const locale = useLocale();
    const t = useTranslations('users.card');
    const { handleRoleChange, isUpdatingRole } = useUserActions();

    const initials = getInitials(user.name);
    const joinedDate = formatDateShort(user.createdAt, locale);

    const handleManageClick = useCallback(
      (opener: HTMLElement | null) => {
        onManagePermissions?.(user._id, opener);
      },
      [onManagePermissions, user._id],
    );

    const onRoleChange = useCallback(
      async (newRole: string) => {
        await handleRoleChange(user._id, newRole);
      },
      [handleRoleChange, user._id],
    );

    const isAdminRole = user.role === 'admin';
    const isNormalUser = user.role === 'user';
    const isProtectedRole = isAdminRole || isNormalUser;

    return (
      <article
        data-testid={`user-card-${user._id}`}
        className={cn(
          'group relative p-4 rounded-lg',
          'bg-card border border-border',
          'transition-all duration-200 ease-out',
          'hover:border-input hover:shadow-sm',
          // The dashed line marks an inactive account, so it uses the 3:1 border token.
          user.isDeleted && 'border-dashed border-input',
          className,
        )}
      >
        {/* Header: Avatar + Name/Email + Status Badge */}
        <header className="flex flex-wrap items-start gap-3 mb-3">
          <Avatar className="h-10 w-10 ring-2 ring-offset-2 ring-offset-card ring-transparent group-hover:ring-primary/20 transition-all">
            <AvatarFallback className="bg-secondary text-primary text-sm font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>

          {/* Name and address wrap inside the card, so the whole value is always on screen. */}
          <div className="min-w-0 grow basis-28 [overflow-wrap:anywhere]">
            <Heading level={3} variant="subsectionTitle">
              <span dir="auto" data-testid="user-card-name">
                {user.name}
              </span>
            </Heading>
            <p className="text-xs text-tertiary tracking-wide">
              <span dir="ltr" data-testid="user-card-email">
                {user.email}
              </span>
            </p>
          </div>

          <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
            {user.isDeleted && (
              <StatusBadge
                status="inactive"
                size="sm"
                variant="soft"
                data-testid="user-inactive-badge"
              />
            )}
            <StatusBadge
              status={user.isVerified ? 'verified' : 'pending'}
              size="sm"
              variant="soft"
              data-testid="user-verification-badge"
            />
          </div>
        </header>

        {/* Role Selector + Actions Row */}
        <div className="mb-3 min-h-[32px] flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <PermissionGuard
              permission={USER_PERMISSIONS.UPDATE_ALL}
              fallback={
                <div className="text-xs text-tertiary">
                  {t('role')}{' '}
                  <span dir="ltr" className="font-medium" data-testid="user-card-role">
                    {user.role}
                  </span>
                </div>
              }
            >
              {isProtectedRole || user.isDeleted ? (
                <div className="text-xs text-tertiary">
                  {t('role')} <UserRoleLabel slug={user.role} />
                </div>
              ) : (
                <UserRoleSelector
                  userId={user._id}
                  currentRole={user.role}
                  userName={user.name}
                  onRoleChange={onRoleChange}
                />
              )}
            </PermissionGuard>
          </div>

          {/* Actions menu: revealed on hover, on focus inside, always on touch */}
          <div
            className={cn(
              'motion-safe:transition-all motion-safe:duration-200 flex items-center',
              isAdminRole ? 'invisible' : HOVER_REVEAL_CLASSES,
            )}
          >
            <PermissionGuard permission={USER_PERMISSIONS.UPDATE_ALL}>
              <UserActionsMenu
                user={user}
                onManagePermissions={handleManageClick}
                disabled={isAdminRole}
                busy={isUpdatingRole}
              />
            </PermissionGuard>
          </div>
        </div>

        {/* Metadata Row */}
        <div className="flex items-center justify-between text-xs text-tertiary">
          <span>{t('joined', { date: joinedDate })}</span>
        </div>
      </article>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison for optimal re-renders
    return (
      prevProps.user._id === nextProps.user._id &&
      prevProps.user.name === nextProps.user.name &&
      prevProps.user.email === nextProps.user.email &&
      prevProps.user.role === nextProps.user.role &&
      prevProps.user.isVerified === nextProps.user.isVerified &&
      prevProps.user.isDeleted === nextProps.user.isDeleted &&
      prevProps.onManagePermissions === nextProps.onManagePermissions
    );
  },
);

export default UserCard;
