'use client';

import { useUserPermissionsDialog } from '../../hooks/useUserPermissionsDialog';
import { UserPermissionsBody } from './UserPermissionsBody';
import { FreshProofDialog } from '@/modules/auth/components/FreshProofDialog';
import { PermissionSearchDialog } from '../search/PermissionSearchDialog';
import { FormRootError } from '@/components/forms';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface UserPermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  userName?: string;
  /** Runs when the dialog has closed, to put focus back on what opened it */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Dialog for viewing inherited and managing direct user permissions.
 */
export function UserPermissionsDialog({
  open,
  onOpenChange,
  userId,
  userName,
  onCloseAutoFocus,
}: UserPermissionsDialogProps) {
  const model = useUserPermissionsDialog({ open, userId });
  const { t, mutations, unavailable, addRefusal, readRefusal } = model;
  const changeOpen = (next: boolean) => {
    if (!next) mutations.cancel();
    onOpenChange(next);
  };
  const changeSearch = (next: boolean) => {
    if (!next) {
      mutations.cancel();
      addRefusal.clear();
    }
    model.setSearchDialogOpen(next);
  };
  const confirm = () => {
    if (unavailable || mutations.busy) return;
    addRefusal.clear();
    void mutations.add(model.availablePermissions);
  };
  return (
    <>
      <Dialog key={userId || 'none'} open={open} busy={mutations.busy} onOpenChange={changeOpen}>
        <DialogContent
          className="max-h-[90vh] max-w-3xl overflow-y-auto"
          data-testid="user-permissions-dialog"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>
              {userName ? t('descriptionWithUser', { name: userName }) : t('descriptionGeneric')}
            </DialogDescription>
          </DialogHeader>
          <FormRootError error={readRefusal.alert} />
          <div className="space-y-6 py-6">
            <UserPermissionsBody model={model} />
          </div>
        </DialogContent>
      </Dialog>
      <PermissionSearchDialog
        open={model.searchDialogOpen}
        onOpenChange={changeSearch}
        refusal={addRefusal.alert || readRefusal.alert}
        selectedPermissions={model.selectedPermissions}
        onChange={model.setSelectedPermissions}
        excludedPermissions={model.effectivePermissions}
        isLoading={model.controlsBusy}
        onConfirm={confirm}
      />
      {mutations.operation.methods && (
        <FreshProofDialog
          methods={mutations.operation.methods}
          onProved={mutations.operation.proved}
          onCancel={mutations.cancel}
        />
      )}
    </>
  );
}
