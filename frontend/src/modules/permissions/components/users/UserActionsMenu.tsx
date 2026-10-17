'use client';

import { memo, useState, useCallback } from 'react';
import { useStaffOperation } from '@/modules/auth/hooks/useStaffOperation';
import { useStaffDialogIntent } from '@/modules/auth/hooks/useStaffDialogIntent';
import { FreshProofDialog } from '@/modules/auth/components/FreshProofDialog';
import { requireObservedVersion } from '@/modules/auth/utils/observedVersion';
import { toast } from '@/lib/toast';
import { reportUnlessHandled } from '@/lib/requestFailure';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Settings, MoreHorizontal, UserCheck, UserX, Loader2, Pencil, Mail } from 'lucide-react';
import { SESSION_PERMISSIONS, ROLE_AUDIENCE, USER_PERMISSIONS, type RoleAudience } from '@app/core';
import { UserSessionsDialog } from './UserSessionsDialog';
import { cn } from '@/lib/utils';
import { useReturnFocus } from '@/hooks/useReturnFocus';
import { useUserActions } from '../../hooks/useUserActions';
import { EditUserDialog } from './EditUserDialog';
import { UserActionConfirmDialog, type UserConfirmAction } from './UserActionConfirmDialog';
import { useRefusalText } from '@/hooks/useRefusalText';
import { usePermission } from '../../hooks/usePermission';
import { PermissionGuard } from '../guards/PermissionGuard';

export interface UserActionsMenuUser {
  version?: number;
  pendingEmail?: string | null;
  _id: string;
  name: string;
  email: string;
  role: string;
  isDeleted: boolean;
  isVerified: boolean;
  audience?: RoleAudience;
}

export interface UserActionsMenuProps {
  /** User data */
  user: UserActionsMenuUser;
  /** Called when manage permissions is chosen, with the menu button to return focus to */
  onManagePermissions?: (opener: HTMLElement | null) => void;
  /** Whether actions are disabled */
  disabled?: boolean;
  /** Another request for this user is running: the button keeps focus and does not open */
  busy?: boolean;
  /** Additional className */
  className?: string;
}

/**
 * UserActionsMenu - Dropdown menu with user actions and co-located dialogs.
 *
 * Features:
 * - Edit, Manage Permissions, Activate/Deactivate actions
 * - Co-located confirmation dialog for activate and deactivate
 * - Co-located edit dialog
 * - Loading states for async operations
 * - Role-based action visibility
 *
 * @example
 * ```tsx
 * <UserActionsMenu
 *   user={user}
 *   onManagePermissions={() => openPermissionsDialog(user._id)}
 * />
 * ```
 */
export const UserActionsMenu = memo(function UserActionsMenu({
  user,
  onManagePermissions,
  disabled = false,
  busy = false,
  className,
}: UserActionsMenuProps) {
  const t = useTranslations('users.actions');
  const sessionsText = useTranslations('adminSessions');
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const openSessions = useCallback(() => setSessionsOpen(true), []);
  const refusalText = useRefusalText();
  const { can } = usePermission();
  const isStaff = user.audience === ROLE_AUDIENCE.STAFF;
  const canUpdate = can(isStaff ? USER_PERMISSIONS.UPDATE_STAFF : USER_PERMISSIONS.UPDATE_ALL);
  const canSuspend = can(isStaff ? USER_PERMISSIONS.SUSPEND_STAFF : USER_PERMISSIONS.SUSPEND_ALL);
  // Why the last attempt was refused, said in the confirmation, which stays open.
  const [refusal, setRefusal] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<UserConfirmAction | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const operation = useStaffOperation();
  const intent = useStaffDialogIntent(confirmAction !== null, `${user._id}:${confirmAction ?? ''}`);
  const resendIntent = useStaffDialogIntent(
    true,
    JSON.stringify([user._id, user.version, user.pendingEmail]),
  );
  const { handleStatusChange, handleResendEmailChange, isLoading } = useUserActions();
  // The dialogs open from menu entries, which are gone by the time they close.
  const [menuButtonRef, returnFocusToMenuButton] = useReturnFocus<HTMLButtonElement>();

  const isNormalUser = user.role === 'user';
  const isBusy = busy || isLoading || operation.busy;
  const changeMenuOpen = useCallback(
    (next: boolean) => {
      if (!(isBusy && next)) setMenuOpen(next);
    },
    [isBusy],
  );

  // Handle confirmation action
  const handleConfirm = useCallback(async () => {
    if (confirmAction === null || operation.busy) return;
    const isActive = confirmAction === 'activate';
    const targetId = user._id;
    const name = user.name;
    const version = user.version;
    setRefusal(null);
    await operation.start({
      isCurrent: intent.capture(),
      run: () =>
        handleStatusChange({
          userId: targetId,
          isActive,
          version: requireObservedVersion(version),
        }),
      onSuccess: () => {
        toast.success(isActive ? t('activateSuccess', { name }) : t('deactivateSuccess', { name }));
        setConfirmAction(null);
      },
      onError: (error) => {
        setRefusal(refusalText(error));
        reportUnlessHandled(error);
      },
    });
  }, [
    confirmAction,
    operation,
    intent,
    handleStatusChange,
    refusalText,
    user._id,
    user.name,
    user.version,
    t,
  ]);

  const handleCancelConfirm = useCallback(() => {
    intent.invalidate();
    operation.cancelProof();
    setConfirmAction(null);
    setRefusal(null);
  }, [intent, operation]);
  const handleResend = useCallback(() => {
    if (operation.busy || operation.methods) return;
    const userId = user._id;
    const version = user.version;
    void operation.start({
      isCurrent: resendIntent.capture(),
      run: () => handleResendEmailChange({ userId, version: requireObservedVersion(version) }),
      onSuccess: () => toast.success(t('resendEmailChangeSuccess')),
      onError: (error) => {
        toast.error(refusalText(error));
      },
    });
  }, [handleResendEmailChange, user._id, user.version, operation, resendIntent, refusalText, t]);

  if (!canUpdate && !canSuspend) return null;

  return (
    <>
      {operation.methods && (
        <FreshProofDialog
          methods={operation.methods}
          onProved={operation.proved}
          onCancel={operation.cancelProof}
        />
      )}
      <DropdownMenu open={menuOpen} onOpenChange={changeMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={menuButtonRef}
            variant="ghost"
            size="sm"
            className={cn(
              'h-8 px-3 gap-1.5 text-xs font-medium',
              'border border-transparent hover:border-border',
              'transition-all duration-200',
              className,
            )}
            disabled={disabled}
            busy={isBusy}
            aria-label={t('menuLabelForUser', { name: user.name })}
            aria-busy={isLoading}
            data-testid={`user-actions-menu-${user._id}`}
          >
            <span>{t('menuLabel')}</span>
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <PermissionGuard permission={SESSION_PERMISSIONS.READ_ALL}>
            <DropdownMenuItem onClick={openSessions} data-testid={`account-sessions-${user._id}`}>
              {sessionsText('title')}
            </DropdownMenuItem>
          </PermissionGuard>
          {Boolean(user.pendingEmail?.trim()) && !user.isDeleted && (
            <PermissionGuard
              permission={isStaff ? USER_PERMISSIONS.UPDATE_STAFF : USER_PERMISSIONS.UPDATE_ALL}
            >
              <DropdownMenuItem
                onClick={handleResend}
                disabled={isLoading}
                data-testid={`resend-email-change-${user._id}`}
              >
                <Mail className="me-2 h-4 w-4" aria-hidden="true" />
                {t('resendEmailChange')}
              </DropdownMenuItem>
            </PermissionGuard>
          )}
          {/* Full menu for non-user roles (support, manager, etc.) */}
          {!isNormalUser && canUpdate && (
            <>
              <DropdownMenuItem
                onClick={() => setEditDialogOpen(true)}
                data-testid={`edit-user-${user._id}`}
              >
                <Pencil className="me-2 h-4 w-4" aria-hidden="true" />
                {t('editUser')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onManagePermissions?.(menuButtonRef.current)}
                data-testid={`manage-permissions-${user._id}`}
              >
                <Settings className="me-2 h-4 w-4" aria-hidden="true" />
                {t('managePermissions')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {/* Activate/Deactivate - available for all non-admin users */}
          {canSuspend &&
            (user.isDeleted ? (
              <DropdownMenuItem
                onClick={() => setConfirmAction('activate')}
                data-testid={`activate-user-${user._id}`}
              >
                <UserCheck className="me-2 h-4 w-4 text-status-success" aria-hidden="true" />
                <span>{t('activateUser')}</span>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() => setConfirmAction('deactivate')}
                data-testid={`deactivate-user-${user._id}`}
              >
                <UserX className="me-2 h-4 w-4 text-status-warning" aria-hidden="true" />
                <span>{t('deactivateUser')}</span>
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <UserSessionsDialog
        userId={user._id}
        open={sessionsOpen}
        onOpenChange={setSessionsOpen}
        onCloseAutoFocus={returnFocusToMenuButton}
      />
      {/* Co-located Edit Dialog */}
      <EditUserDialog
        userId={user._id}
        currentName={user.name}
        currentEmail={user.email}
        currentVersion={user.version}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onCloseAutoFocus={returnFocusToMenuButton}
      />

      {/* Co-located Confirmation Dialog */}
      <UserActionConfirmDialog
        action={confirmAction}
        userName={user.name}
        isLoading={isLoading || operation.busy}
        refusal={refusal}
        onConfirm={handleConfirm}
        onCancel={handleCancelConfirm}
        onCloseAutoFocus={returnFocusToMenuButton}
      />
    </>
  );
});

export default UserActionsMenu;
