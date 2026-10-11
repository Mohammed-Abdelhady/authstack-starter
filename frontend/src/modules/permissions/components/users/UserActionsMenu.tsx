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
import { useUserActions } from '../../hooks/useUserActions';
import { EditUserDialog } from './EditUserDialog';
import { UserActionConfirmDialog, type UserConfirmAction } from './UserActionConfirmDialog';
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
  /** Callback when manage permissions is clicked */
  onManagePermissions?: () => void;
  /** Whether actions are disabled */
  disabled?: boolean;
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
  className,
}: UserActionsMenuProps) {
  const t = useTranslations('users.actions');
  const [confirmAction, setConfirmAction] = useState<UserConfirmAction | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const { handleStatusChange, handleResendEmailChange, isLoading } = useUserActions();

  const isNormalUser = user.role === 'user';

  // Handle confirmation action
  const handleConfirm = useCallback(async () => {
    let success = false;

    if (confirmAction === 'activate') {
      success = await handleStatusChange(user._id, true, user.name);
    } else if (confirmAction === 'deactivate') {
      success = await handleStatusChange(user._id, false, user.name);
    }

    if (success) {
      setConfirmAction(null);
    }
  }, [confirmAction, handleStatusChange, user._id, user.name]);

  const handleCancelConfirm = useCallback(() => setConfirmAction(null), []);
  const handleResend = useCallback(() => {
    void handleResendEmailChange(user._id);
  }, [handleResendEmailChange, user._id]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-8 px-3 gap-1.5 text-xs font-medium',
              'border border-transparent hover:border-border',
              'transition-all duration-200',
              className,
            )}
            disabled={disabled || isLoading}
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
                onClick={onManagePermissions}
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
      />

      {/* Co-located Confirmation Dialog */}
      <UserActionConfirmDialog
        action={confirmAction}
        userName={user.name}
        isLoading={isLoading}
        onConfirm={handleConfirm}
        onCancel={handleCancelConfirm}
      />
    </>
  );
});

export default UserActionsMenu;
