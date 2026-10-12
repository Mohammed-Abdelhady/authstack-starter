'use client';

import { memo, useState, useCallback } from 'react';
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
import { USER_PERMISSIONS } from '@app/core';
import { cn } from '@/lib/utils';
import { useReturnFocus } from '@/hooks/useReturnFocus';
import { useUserActions } from '../../hooks/useUserActions';
import { EditUserDialog } from './EditUserDialog';
import { UserActionConfirmDialog, type UserConfirmAction } from './UserActionConfirmDialog';
import { useRefusalText } from '@/hooks/useRefusalText';
import { PermissionGuard } from '../guards/PermissionGuard';

export interface UserActionsMenuUser {
  _id: string;
  name: string;
  email: string;
  role: string;
  isDeleted: boolean;
  isVerified: boolean;
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
  const refusalText = useRefusalText();
  // Why the last attempt was refused, said in the confirmation, which stays open.
  const [refusal, setRefusal] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<UserConfirmAction | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { handleStatusChange, handleResendEmailChange, isLoading } = useUserActions();
  // The dialogs open from menu entries, which are gone by the time they close.
  const [menuButtonRef, returnFocusToMenuButton] = useReturnFocus<HTMLButtonElement>();

  const isNormalUser = user.role === 'user';
  const isBusy = busy || isLoading;
  const changeMenuOpen = useCallback(
    (next: boolean) => {
      if (!(isBusy && next)) setMenuOpen(next);
    },
    [isBusy],
  );

  // Handle confirmation action
  const handleConfirm = useCallback(async () => {
    if (confirmAction === null) return;
    setRefusal(null);
    const success = await handleStatusChange(
      user._id,
      confirmAction === 'activate',
      user.name,
      (error) => setRefusal(refusalText(error)),
    );

    if (success) {
      setConfirmAction(null);
    }
  }, [confirmAction, handleStatusChange, refusalText, user._id, user.name]);

  const handleCancelConfirm = useCallback(() => {
    setConfirmAction(null);
    setRefusal(null);
  }, []);
  const handleResend = useCallback(() => {
    void handleResendEmailChange(user._id);
  }, [handleResendEmailChange, user._id]);

  return (
    <>
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
          {!user.isVerified && !user.isDeleted && (
            <PermissionGuard permission={USER_PERMISSIONS.UPDATE_ALL}>
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
          {!isNormalUser && (
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
          {user.isDeleted ? (
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
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Co-located Edit Dialog */}
      <EditUserDialog
        userId={user._id}
        currentName={user.name}
        currentEmail={user.email}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onCloseAutoFocus={returnFocusToMenuButton}
      />

      {/* Co-located Confirmation Dialog */}
      <UserActionConfirmDialog
        action={confirmAction}
        userName={user.name}
        isLoading={isLoading}
        refusal={refusal}
        onConfirm={handleConfirm}
        onCancel={handleCancelConfirm}
        onCloseAutoFocus={returnFocusToMenuButton}
      />
    </>
  );
});

export default UserActionsMenu;
