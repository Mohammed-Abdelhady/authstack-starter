'use client';

import { useRoleUpdate } from '@/modules/permissions/hooks/useRoleUpdate';
import { FreshProofDialog } from '@/modules/auth/components/FreshProofDialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { type Role } from '../../api/rolesApi';
import { EditRoleForm } from './EditRoleForm';
import { useState } from 'react';

export interface EditRoleDialogProps {
  /**
   * Whether the dialog is open
   */
  open: boolean;

  /**
   * Callback when dialog should close
   */
  onOpenChange: (open: boolean) => void;

  /**
   * Role to edit
   */
  role: Role | null;

  /**
   * Callback when role is successfully updated
   */
  onSuccess?: () => void;
}

/**
 * Dialog for editing an existing role.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 * const [selectedRole, setSelectedRole] = useState<Role | null>(null);
 *
 * <EditRoleDialog open={open} onOpenChange={setOpen} role={selectedRole} />
 * ```
 */
export function EditRoleDialog({ open, onOpenChange, role, onSuccess }: EditRoleDialogProps) {
  const { operation, isLoading, invalidate, submissionInFlight, handleSubmit } = useRoleUpdate({
    open,
    role,
    onOpenChange,
    onSuccess,
  });
  const [formRevision, setFormRevision] = useState(0);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      if (submissionInFlight.current) return;
      invalidate();
      operation.cancelProof();
      setFormRevision((revision) => revision + 1);
    }
    onOpenChange(nextOpen);
  };

  const handleCancel = () => {
    handleOpenChange(false);
  };

  if (!role) return null;

  return (
    <>
      <Dialog open={open} busy={isLoading} onOpenChange={handleOpenChange}>
        <DialogContent
          className="max-h-[90vh] max-w-3xl overflow-y-auto"
          data-testid="edit-role-dialog"
        >
          {/* Key forces remount when role changes, reinitializing state */}
          <EditRoleForm
            key={`${role.id}-${formRevision}`}
            role={role}
            isLoading={isLoading}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
          />
        </DialogContent>
      </Dialog>
      {operation.methods && (
        <FreshProofDialog
          methods={operation.methods}
          onProved={operation.proved}
          onCancel={operation.cancelProof}
        />
      )}
    </>
  );
}
