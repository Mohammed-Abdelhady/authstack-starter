import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from '@/lib/toast';
import { reportUnlessHandled } from '@/lib/requestFailure';
import { useGetUserPermissionsQuery, type UserPermissionsResponse } from '../api/permissionsApi';
import { useGetRoleQuery } from '@/modules/roles/api/rolesApi';
import type { Role } from '@/modules/roles/types';
import { useDialogRefusal } from '@/hooks/useFormRefusal';
import { useUserPermissionMutations } from './useUserPermissionMutations';

function permissionSummary(
  data: UserPermissionsResponse | undefined,
  roleData: Role | undefined,
  selectedPermissions: string[],
) {
  const userPermissions = data?.permissions || [];
  const rolePermissions = roleData?.permissions || [];

  // Direct permissions are those not inherited from role
  const directPermissions = userPermissions.filter((p) => !rolePermissions.includes(p));
  const inheritedPermissions = rolePermissions;

  // All effective permissions (role + direct, deduplicated)
  const effectivePermissions = [...new Set([...rolePermissions, ...userPermissions])];
  const hasWildcard = effectivePermissions.includes('*');

  // Filter out permissions the user already has when adding (both direct and inherited)
  const availablePermissions = selectedPermissions.filter((p) => !effectivePermissions.includes(p));

  return {
    directPermissions,
    inheritedPermissions,
    effectivePermissions,
    hasWildcard,
    availablePermissions,
  };
}

function usePermissionRead(open: boolean, userId: string | null) {
  const {
    currentData: data,
    isLoading,
    isFetching,
    error: readError,
    refetch,
  } = useGetUserPermissionsQuery(userId || '', { skip: !open || !userId });

  // Fetch role permissions to show inherited permissions
  const { currentData: roleData, isLoading: isLoadingRole } = useGetRoleQuery(data?.role || '', {
    skip: !data?.role,
  });

  const readRefusal = useDialogRefusal();
  const { show, clear } = readRefusal;
  useEffect(() => {
    if (readError) show(readError);
    else clear();
  }, [readError, show, clear]);
  return { data, roleData, isLoading, isLoadingRole, isFetching, readError, refetch, readRefusal };
}

export function useUserPermissionsDialog({
  open,
  userId,
}: {
  open: boolean;
  userId: string | null;
}) {
  const t = useTranslations('permissions.dialog');
  const tCommon = useTranslations('common');
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [previousView, setPreviousView] = useState({ open, userId });
  if (previousView.open !== open || previousView.userId !== userId) {
    setPreviousView({ open, userId });
    setSelectedPermissions([]);
    setSearchDialogOpen(false);
  }

  const reading = usePermissionRead(open, userId);
  const { data, roleData, isFetching, readError, refetch } = reading;

  const addRefusal = useDialogRefusal();
  const removeRefusal = useDialogRefusal();
  const directHeadingRef = useRef<HTMLHeadingElement>(null);
  const mutations = useUserPermissionMutations({
    open,
    userId,
    version: data?.version,
    refetch,
    onAdded: (count) => {
      toast.success(t('addSuccess', { count }));
      setSelectedPermissions([]);
      setSearchDialogOpen(false);
    },
    onRemoved: () => {
      toast.success(t('removeSuccess'));
      directHeadingRef.current?.focus();
    },
    onAddError: (error) => {
      addRefusal.show(error);
      reportUnlessHandled(error);
    },
    onRemoveError: (error) => {
      removeRefusal.show(error);
      reportUnlessHandled(error);
    },
  });
  const { removing, cancel } = mutations;
  const prerequisiteUnavailable = readError !== undefined || data === undefined;
  const controlsBusy = mutations.busy || isFetching;
  const unavailable = isFetching || prerequisiteUnavailable;
  useEffect(() => {
    cancel();
  }, [open, userId, cancel]);

  const summary = permissionSummary(data, roleData, selectedPermissions);
  return {
    t,
    tCommon,
    searchDialogOpen,
    setSearchDialogOpen,
    selectedPermissions,
    setSelectedPermissions,
    ...reading,
    addRefusal,
    removeRefusal,
    directHeadingRef,
    mutations,
    removing,
    prerequisiteUnavailable,
    controlsBusy,
    unavailable,
    ...summary,
  };
}
