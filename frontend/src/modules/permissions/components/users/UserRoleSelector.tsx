'use client';

import { useRef, useState } from 'react';
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
import { Loader2, Shield, ShieldAlert } from 'lucide-react';
import { RoleListError } from '@/modules/roles/components/RoleListError';
import { RoleRefusalBadge } from '@/modules/roles/components/RoleRefusalBadge';
import { useAllRoles } from '@/modules/roles/hooks/useAllRoles';
import { toast } from '@/lib/toast';
import { reportUnlessHandled } from '@/lib/requestFailure';
import { useKeyReleaseGuard } from '@/hooks/useKeyReleaseGuard';
import { TruncatedText } from '../shared/TruncatedText';

interface UserRoleSelectorProps {
  readonly userId: string;
  readonly currentRole: string;
  /** Named in the confirmation. A user without a name is called "this user". */
  readonly userName?: string;
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
  userName,
  onRoleChange,
  disabled = false,
}: UserRoleSelectorProps) {
  const t = useTranslations('permissions.userRole');
  const tCommon = useTranslations('common');
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  // The role picked in the list. It becomes `pendingRole` once the list has closed.
  const chosenRole = useRef<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const guardKeyUntilReleased = useKeyReleaseGuard();
  const {
    roles,
    isLoading: isLoadingRoles,
    isError: rolesFailed,
    retry: retryRoles,
    refusalFor,
  } = useAllRoles();

  const handleRoleSelect = (newRole: string) => {
    if (newRole === currentRole) {
      return; // No change
    }

    chosenRole.current = newRole;
  };

  // The confirmation opens once the list has closed and handed focus back, so
  // the trigger holds focus then, and the dialog returns focus to it on close.
  const openConfirmation = () => {
    if (chosenRole.current === null) return;
    setPendingRole(chosenRole.current);
    chosenRole.current = null;
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
  const currentRoleName = currentRoleData?.name || currentRole;
  const pendingRoleData = pendingRole ? roles.find((r) => r.slug === pendingRole) : null;

  if (rolesFailed) {
    return (
      <div className="space-y-1" data-testid={`user-role-unavailable-${userId}`}>
        <span dir="ltr" className="text-xs font-medium">
          {currentRole}
        </span>
        <RoleListError onRetry={retryRoles} testId={`user-role-list-error-${userId}`} />
      </div>
    );
  }

  return (
    <>
      <Select
        value={currentRole}
        onValueChange={handleRoleSelect}
        disabled={disabled || isLoadingRoles}
        busy={isUpdating}
      >
        <SelectTrigger
          className="w-full sm:w-[200px]"
          aria-label={t('selectorLabel', { role: currentRoleName })}
          aria-busy={isUpdating}
          data-testid={`user-role-selector-${userId}`}
        >
          {isLoadingRoles ? (
            <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <SelectValue>
              {/* One line, cut at the end of the name. The list below shows it whole. */}
              <span className="flex min-w-0 items-center gap-2">
                {currentRoleData?.isSystemRole && <Shield className="h-3 w-3 shrink-0 text-info" />}
                {currentRoleData?.isProtected && (
                  <ShieldAlert className="h-3 w-3 shrink-0 text-status-warning" />
                )}
                <TruncatedText value={currentRoleName} dir="auto" />
              </span>
            </SelectValue>
          )}
        </SelectTrigger>
        <SelectContent onKeyDownCapture={guardKeyUntilReleased} onCloseAutoFocus={openConfirmation}>
          {roles.map((role) => {
            // The role the user holds stays in the list as what is selected.
            const refusal = role.slug === currentRole ? null : refusalFor(role);
            return (
              <SelectItem
                key={role.id}
                value={role.slug}
                disabled={refusal !== null}
                data-testid={`role-option-${role.slug}`}
              >
                <div className="flex items-center gap-2">
                  {role.isSystemRole && <Shield className="h-3 w-3 text-info" />}
                  {role.isProtected && <ShieldAlert className="h-3 w-3 text-status-warning" />}
                  <span dir="auto">{role.name}</span>
                  {refusal && <RoleRefusalBadge refusal={refusal} />}
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {/* Confirmation Dialog */}
      <AlertDialog open={!!pendingRole} onOpenChange={(open) => !open && handleCancelRoleChange()}>
        <AlertDialogContent data-testid="role-change-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('changeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.rich('changeDescription', {
                name: userName?.trim() || t('thisUser'),
                from: currentRoleName,
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
            <AlertDialogCancel busy={isUpdating} data-testid="cancel-role-change-button">
              {tCommon('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRoleChange}
              busy={isUpdating}
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
