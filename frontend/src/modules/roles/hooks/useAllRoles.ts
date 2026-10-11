'use client';

import { useCallback } from 'react';
import { selectUser } from '@/modules/auth/store/authSlice';
import { useAppSelector } from '@/store/hooks';
import { useListAllRolesQuery } from '../api/rolesApi';
import type { RoleRefusal } from '../constants';
import type { Role } from '../types';
import { levelOfRole, roleRefusal } from '../utils/roleAssignment';

const NO_ROLES: Role[] = [];

export interface AllRoles {
  /** Every role, or none until the read has answered or when it failed. */
  roles: Role[];
  isLoading: boolean;
  /** The read failed: the list is missing, not short. */
  isError: boolean;
  retry: () => void;
  /** Why the signed-in person may not hand this role out, or null when they may. */
  refusalFor: (role: Pick<Role, 'slug' | 'level'>) => RoleRefusal | null;
}

/**
 * Every role there is, from one read that every selector and label on the
 * page shares, with what the signed-in person may assign.
 */
export function useAllRoles(): AllRoles {
  const { data, isLoading, isError, refetch } = useListAllRolesQuery();
  const actorRole = useAppSelector(selectUser)?.role ?? '';
  const roles = data ?? NO_ROLES;
  const actorLevel = levelOfRole(roles, actorRole);

  const refusalFor = useCallback(
    (role: Pick<Role, 'slug' | 'level'>) => roleRefusal(actorLevel, role),
    [actorLevel],
  );
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return { roles, isLoading, isError, retry, refusalFor };
}
