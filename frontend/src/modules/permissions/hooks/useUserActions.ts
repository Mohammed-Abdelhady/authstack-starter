import { useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  useUpdateUserStatusMutation,
  useUpdateUserRoleMutation,
  useResendEmailChangeMutation,
} from '@/modules/users/api/usersApi';
import { toast } from '@/lib/toast';
import { reportUnlessHandled } from '@/lib/requestFailure';

/**
 * Return type for the useUserActions hook.
 */
export interface UseUserActionsReturn {
  /** Update user role */
  handleRoleChange: (userId: string, newRole: string) => Promise<void>;
  /** Activate or deactivate user */
  handleStatusChange: (userId: string, isActive: boolean, userName: string) => Promise<boolean>;
  handleResendEmailChange: (userId: string) => Promise<void>;
  /** Whether any action is loading */
  isLoading: boolean;
  /** Whether status update is loading */
  isUpdatingStatus: boolean;
  /** Whether role update is loading */
  isUpdatingRole: boolean;
}

/**
 * useUserActions - Hook for user CRUD operations with toast notifications.
 *
 * Extracts user management logic from components to keep them focused on rendering.
 * Handles error messages and success toasts consistently.
 *
 * @returns Object with action handlers and loading states
 *
 * @example
 * ```tsx
 * function UserCard({ user }) {
 *   const { handleRoleChange, handleStatusChange, isLoading } = useUserActions();
 *
 *   const onActivate = async () => {
 *     const success = await handleStatusChange(user._id, true, user.name);
 *     if (success) {
 *       closeDialog();
 *     }
 *   };
 *
 *   return (
 *     <Button onClick={onActivate} disabled={isLoading}>
 *       Activate
 *     </Button>
 *   );
 * }
 * ```
 */
export function useUserActions(): UseUserActionsReturn {
  const [updateStatus, { isLoading: isUpdatingStatus }] = useUpdateUserStatusMutation();
  const [updateRole, { isLoading: isUpdatingRole }] = useUpdateUserRoleMutation();
  const [resendEmailChange, { isLoading: isResendingEmailChange }] = useResendEmailChangeMutation();
  const resendInFlight = useRef(false);
  const t = useTranslations('users.actions');

  /**
   * Update user role. A refusal rejects, so the caller knows it failed and
   * raises the success message itself.
   */
  const handleRoleChange = useCallback(
    async (userId: string, newRole: string) => {
      await updateRole({ userId, role: newRole }).unwrap();
    },
    [updateRole],
  );

  /**
   * Activate or deactivate user.
   * Returns true on success, false on failure.
   */
  const handleStatusChange = useCallback(
    async (userId: string, isActive: boolean, userName: string): Promise<boolean> => {
      try {
        await updateStatus({ userId, isActive }).unwrap();
        toast.success(
          isActive
            ? t('activateSuccess', { name: userName })
            : t('deactivateSuccess', { name: userName }),
        );
        return true;
      } catch (error) {
        reportUnlessHandled(error);
        return false;
      }
    },
    [updateStatus, t],
  );

  const handleResendEmailChange = useCallback(
    async (userId: string) => {
      if (resendInFlight.current) return;
      resendInFlight.current = true;
      try {
        await resendEmailChange(userId).unwrap();
        toast.success(t('resendEmailChangeSuccess'));
      } catch (error) {
        reportUnlessHandled(error);
      } finally {
        resendInFlight.current = false;
      }
    },
    [resendEmailChange, t],
  );

  const isLoading = isUpdatingStatus || isUpdatingRole || isResendingEmailChange;

  return {
    handleRoleChange,
    handleStatusChange,
    handleResendEmailChange,
    isLoading,
    isUpdatingStatus,
    isUpdatingRole,
  };
}

export default useUserActions;
