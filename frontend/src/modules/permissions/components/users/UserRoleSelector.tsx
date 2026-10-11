'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Loader2, Shield, ShieldAlert } from 'lucide-react';
import { useListRolesQuery } from '../../api/rolesApi';
import { toast } from '@/lib/toast';
import { reportUnlessHandled } from '@/lib/requestFailure';

interface UserRoleSelectorProps {
  readonly userId: string;
  readonly currentRole: string;
  readonly onRoleChange?: (newRole: string) => Promise<void>;
  readonly disabled?: boolean;
}

/**
 * UserRoleSelector component for changing a user's role
 * Shows a dropdown with available roles and confirmation dialog
 */
export function UserRoleSelector({
  userId,
  currentRole,
  onRoleChange,
  disabled = false,
}: UserRoleSelectorProps) {
  const t = useTranslations('permissions.userRole');
  const tCommon = useTranslations('common');
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const { data: rolesData, isLoading: isLoadingRoles } = useListRolesQuery(undefined);

  const roles = rolesData?.roles || [];

  const handleRoleSelect = (newRole: string) => {
    if (newRole === currentRole) {
      return; // No change
    }

    // Check if the role is protected (admin roles)
    const selectedRole = roles.find((r) => r.slug === newRole);
    if (selectedRole?.isProtected && newRole !== currentRole) {
      toast.error(t('cannotAssignProtected'));
      return;
    }

    setPendingRole(newRole);
  };

  const handleConfirmRoleChange = async () => {
    if (!pendingRole || !onRoleChange) {
      return;
    }

    setIsUpdating(true);
    try {
      await onRoleChange(pendingRole);
      const roleName = roles.find((r) => r.slug === pendingRole)?.name || pendingRole;
      toast.success(t('changeSuccess', { role: roleName }));
      setPendingRole(null);
    } catch (error) {
      reportUnlessHandled(error);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCancelRoleChange = () => {
    setPendingRole(null);
  };

  const currentRoleData = roles.find((r) => r.slug === currentRole);
  const pendingRoleData = pendingRole ? roles.find((r) => r.slug === pendingRole) : null;

  return (
    <>
      <Select
        value={currentRole}
        onValueChange={handleRoleSelect}
        disabled={disabled || isLoadingRoles || isUpdating}
      >
        <SelectTrigger className="w-full sm:w-[200px]" data-testid={`user-role-selector-${userId}`}>
          {isLoadingRoles ? (
            <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <SelectValue>
              <div className="flex items-center gap-2">
                {currentRoleData?.isSystemRole && (
                  <Shield className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                )}
                {currentRoleData?.isProtected && (
                  <ShieldAlert className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                )}
                <span dir="auto">{currentRoleData?.name || currentRole}</span>
              </div>
            </SelectValue>
          )}
        </SelectTrigger>
        <SelectContent>
          {roles.map((role) => (
            <SelectItem
              key={role.id}
              value={role.slug}
              disabled={role.isProtected && role.slug !== currentRole}
              data-testid={`role-option-${role.slug}`}
            >
              <div className="flex items-center gap-2">
                {role.isSystemRole && (
                  <Shield className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                )}
                {role.isProtected && (
                  <ShieldAlert className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                )}
                <span dir="auto">{role.name}</span>
                {role.isProtected && role.slug !== currentRole && (
                  <Badge variant="secondary" className="ms-2 text-xs">
                    {t('protected')}
                  </Badge>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Confirmation Dialog */}
      <AlertDialog open={!!pendingRole} onOpenChange={(open) => !open && handleCancelRoleChange()}>
        <AlertDialogContent data-testid="role-change-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('changeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.rich('changeDescription', {
                name: 'this user',
                from: currentRoleData?.name || currentRole,
                to: pendingRoleData?.name || pendingRole || '',
                strong: (chunks) => (
                  <strong>
                    <span dir="auto">{chunks}</span>
                  </strong>
                ),
              })}
              <br />
              <br />
              {t('changeWarning')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUpdating} data-testid="cancel-role-change-button">
              {tCommon('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRoleChange}
              disabled={isUpdating}
              aria-busy={isUpdating}
              data-testid="confirm-role-change-button"
            >
              {isUpdating ? (
                <>
                  <Loader2 className="me-2 h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
                  {t('changing')}
                </>
              ) : (
                t('changeRole')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
