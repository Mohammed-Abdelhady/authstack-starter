'use client';

import { memo, useCallback, useEffect, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Heading, StatusBadge } from '@/components/design-system';
import { UserRoleSelector } from './UserRoleSelector';
import { UserActionsMenu } from './UserActionsMenu';
import { UserRoleLabel } from './UserRoleLabel';
import { PermissionGuard } from '@/modules/permissions';
import { ROLE_AUDIENCE, USER_PERMISSIONS, type RoleAudience } from '@app/core';
import { HOVER_REVEAL_CLASSES } from '@/constants/focusStyles';
import { cn } from '@/lib/utils';
import { getInitials, formatDateShort } from '@/lib/formatters';
import { requireObservedVersion } from '@/modules/auth/utils/observedVersion';
import { useAuthMethods } from '@/modules/auth/hooks/useAuthMethods';
import { usePermission } from '../../hooks/usePermission';
import { useUserActions } from '../../hooks/useUserActions';

export interface User {
  version?: number;
  _id: string;
  name: string;
  email: string;
  role: string;
  isVerified: boolean;
  isDeleted: boolean;
  pendingEmail?: string | null;
  createdAt: string;
  audience?: RoleAudience;
}

export interface UserCardProps {
  /** User data */
  user: User;
  /** Callback when manage permissions is clicked */
  onManagePermissions?: (userId: string, opener: HTMLElement | null, userName: string) => void;
  /** Optional className */
  className?: string;
}

function assignmentPermission(
  audience: RoleAudience | undefined,
  audiencesEnabled: boolean,
): string {
  return audiencesEnabled && audience === ROLE_AUDIENCE.STAFF
    ? USER_PERMISSIONS.ASSIGN_ROLE_STAFF
    : USER_PERMISSIONS.ASSIGN_ROLE_ALL;
}

function focusRoleRegionIfOwned(region: HTMLDivElement | null) {
  const activeElement = document.activeElement;
  if (region && (activeElement === document.body || region.contains(activeElement))) {
    region.focus();
  }
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
    const roleRegionRef = useRef<HTMLDivElement>(null);
    const previousUser = useRef({ id: user._id, role: user.role });
    const confirmedRoleFocus = useRef<{ userId: string; role: string } | null>(null);

    useEffect(() => {
      const previous = previousUser.current;
      previousUser.current = { id: user._id, role: user.role };
      const intent = confirmedRoleFocus.current;
      confirmedRoleFocus.current = null;
      if (
        previous.id !== user._id ||
        previous.role === user.role ||
        intent?.userId !== user._id ||
        intent.role !== user.role ||
        (user.role !== 'user' && user.role !== 'admin')
      ) {
        return;
      }
      focusRoleRegionIfOwned(roleRegionRef.current);
    }, [user._id, user.role]);

    const initials = getInitials(user.name);
    const joinedDate = formatDateShort(user.createdAt, locale);

    const handleManageClick = useCallback(
      (opener: HTMLElement | null) => {
        onManagePermissions?.(user._id, opener, user.name);
      },
      [onManagePermissions, user._id, user.name],
    );

    const onRoleChange = useCallback(
      async (newRole: string) => {
        confirmedRoleFocus.current = null;
        await handleRoleChange({
          userId: user._id,
          newRole,
          version: requireObservedVersion(user.version),
        });
        confirmedRoleFocus.current = { userId: user._id, role: newRole };
        if (previousUser.current.id === user._id && previousUser.current.role === newRole) {
          confirmedRoleFocus.current = null;
          if (newRole === 'user' || newRole === 'admin') {
            focusRoleRegionIfOwned(roleRegionRef.current);
          }
        }
      },
      [handleRoleChange, user._id, user.version],
    );

    const isAdminRole = user.role === 'admin';
    const isNormalUser = user.role === 'user';
    const isProtectedRole = isAdminRole || isNormalUser;
    const { canAny } = usePermission();
    const { audiencesEnabled } = useAuthMethods({
      skip:
        isProtectedRole ||
        user.isDeleted ||
        !canAny([USER_PERMISSIONS.ASSIGN_ROLE_ALL, USER_PERMISSIONS.ASSIGN_ROLE_STAFF]),
    });

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
            {user.pendingEmail && (
              <p className="text-xs text-status-warning" data-testid="user-card-pending-email">
                {t('pendingEmail', { email: user.pendingEmail })}
              </p>
            )}
          </div>

          <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
            {user.isDeleted && (
              <StatusBadge
                status="inactive"
                size="sm"
                variant="soft"
                className="rtl:tracking-normal"
                data-testid="user-inactive-badge"
              />
            )}
            <StatusBadge
              status={user.isVerified ? 'verified' : 'pending'}
              size="sm"
              variant="soft"
              className="rtl:tracking-normal"
              data-testid="user-verification-badge"
            />
          </div>
        </header>

        {/* Role Selector + Actions Row */}
        <div className="mb-3 min-h-[32px] flex items-center justify-between gap-2">
          <div
            ref={roleRegionRef}
            role="group"
            aria-label={t('role')}
            tabIndex={-1}
            className="flex-1 min-w-0"
            data-testid="user-card-role-region"
          >
            <PermissionGuard
              permission={assignmentPermission(user.audience, audiencesEnabled === true)}
              fallback={
                <div className="text-xs text-tertiary">
                  {t('role')}{' '}
                  <span dir="ltr" className="font-medium" data-testid="user-card-role">
                    {user.role}
                  </span>
                </div>
              }
            >
              {audiencesEnabled === undefined || isProtectedRole || user.isDeleted ? (
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
            <UserActionsMenu
              user={user}
              onManagePermissions={handleManageClick}
              disabled={isAdminRole}
              busy={isUpdatingRole}
            />
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
      prevProps.user.version === nextProps.user.version &&
      prevProps.user.isVerified === nextProps.user.isVerified &&
      prevProps.user.isDeleted === nextProps.user.isDeleted &&
      prevProps.user.pendingEmail === nextProps.user.pendingEmail &&
      prevProps.user.audience === nextProps.user.audience &&
      prevProps.onManagePermissions === nextProps.onManagePermissions
    );
  },
);

export default UserCard;
