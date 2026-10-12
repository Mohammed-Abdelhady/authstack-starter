'use client';

import { useTranslations } from 'next-intl';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useUpdateRoleMutation, type Role } from '../../api/rolesApi';
import { EditRoleForm, type EditRoleFormValues } from './EditRoleForm';
import { showsOwnRefusal } from '@/lib/refusal';
import { toast } from '@/lib/toast';
import { reportUnlessHandled } from '@/lib/requestFailure';
import { useRef, useState } from 'react';

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
  const t = useTranslations('roles.form');
  const [updateRole, { isLoading }] = useUpdateRoleMutation();
  const [formRevision, setFormRevision] = useState(0);
  const submissionInFlight = useRef(false);

  const handleSubmit = async (data: EditRoleFormValues, showRefusal: (error: unknown) => void) => {
    if (!role || submissionInFlight.current) return;
    submissionInFlight.current = true;

    const isBaseRole = role.slug === 'user' || role.slug === 'admin';

    try {
      // For base roles, only update permissions
      const updateData = isBaseRole
        ? { permissions: data.permissions }
        : {
            name: data.name.trim(),
            description: data.description.trim() || undefined,
            permissions: data.permissions,
          };

      await showsOwnRefusal(
        updateRole({
          idOrSlug: role.id,
          data: updateData,
        }),
      ).unwrap();

      toast.success(t('updateSuccess', { name: data.name.trim() || role.name }));
      submissionInFlight.current = false;
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      showRefusal(error);
      reportUnlessHandled(error);
    } finally {
      submissionInFlight.current = false;
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      if (submissionInFlight.current) return;
      setFormRevision((revision) => revision + 1);
    }
    onOpenChange(nextOpen);
  };

  const handleCancel = () => {
    handleOpenChange(false);
  };

  if (!role) return null;

  return (
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
  );
}
