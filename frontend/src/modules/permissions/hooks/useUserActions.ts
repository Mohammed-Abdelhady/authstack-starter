import { useCallback, useRef } from 'react';
import {
  useUpdateUserStatusMutation,
  useUpdateUserRoleMutation,
  useResendEmailChangeMutation,
} from '@/modules/users/api/usersApi';
import { showsOwnRefusal } from '@/lib/refusal';
import type { ResendEmailChangeRequest } from '@/modules/users/types';

/**
 * Return type for the useUserActions hook.
 */
interface RoleChange {
  userId: string;
  newRole: string;
  version: number;
}
interface StatusChange {
  userId: string;
  isActive: boolean;
  version: number;
}

export interface UseUserActionsReturn {
  handleRoleChange: (change: RoleChange) => Promise<void>;
  handleStatusChange: (change: StatusChange) => Promise<void>;
  handleResendEmailChange: (change: ResendEmailChangeRequest) => Promise<void>;
  isLoading: boolean;
  isUpdatingStatus: boolean;
  isUpdatingRole: boolean;
}

export function useUserActions(): UseUserActionsReturn {
  const [updateStatus, { isLoading: isUpdatingStatus }] = useUpdateUserStatusMutation();
  const [updateRole, { isLoading: isUpdatingRole }] = useUpdateUserRoleMutation();
  const [resendEmailChange, { isLoading: isResendingEmailChange }] = useResendEmailChangeMutation();
  const resendInFlight = useRef(false);

  /**
   * Update user role. A refusal rejects, so the caller knows it failed, says
   * why in its confirmation and raises the success message itself.
   */
  const handleRoleChange = useCallback(
    async ({ userId, newRole, version }: RoleChange) => {
      await showsOwnRefusal(updateRole({ userId, role: newRole, version })).unwrap();
    },
    [updateRole],
  );

  const handleStatusChange = useCallback(
    async (change: StatusChange) => {
      await showsOwnRefusal(updateStatus(change)).unwrap();
    },
    [updateStatus],
  );

  const handleResendEmailChange = useCallback(
    async (change: ResendEmailChangeRequest) => {
      if (resendInFlight.current) return;
      resendInFlight.current = true;
      try {
        await showsOwnRefusal(resendEmailChange(change)).unwrap();
      } finally {
        resendInFlight.current = false;
      }
    },
    [resendEmailChange],
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
