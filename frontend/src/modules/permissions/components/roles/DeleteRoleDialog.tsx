'use client';

import { useRoleDeletion } from '@/modules/permissions/hooks/useRoleDeletion';
import { RoleDeletionSummary } from './RoleDeletionSummary';
import { FreshProofDialog } from '@/modules/auth/components/FreshProofDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { type Role } from '../../api/rolesApi';
import { FormRootError } from '@/components/forms';
import { useRemovalFocus, type RemovalLanding } from '@/hooks/useRemovalFocus';

export interface DeleteRoleDialogProps {
  /**
   * Whether the dialog is open
   */
  open: boolean;

  /**
   * Callback when dialog should close
   */
  onOpenChange: (open: boolean) => void;

  /**
   * Role to delete
   */
  role: Role | null;

  /**
   * Callback when role is successfully deleted
   */
  onSuccess?: () => void;

  /**
   * The heading that takes focus once the role is gone
   */
  landing?: RemovalLanding;
}

/**
 * Dialog for confirming role deletion.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 * const [selectedRole, setSelectedRole] = useState<Role | null>(null);
 *
 * <DeleteRoleDialog
 *   open={open}
 *   onOpenChange={setOpen}
 *   role={selectedRole}
 *   onSuccess={() => console.log('Role deleted!')}
 * />
 * ```
 */
export function DeleteRoleDialog({
  open,
  onOpenChange,
  role,
  onSuccess,
  landing,
}: DeleteRoleDialogProps) {
  const { noteRemoved, focusLanding } = useRemovalFocus(landing);
  const { t, operation, isLoading, refusal, changeOpen, handleDelete } = useRoleDeletion({
    open,
    role,
    onOpenChange,
    onSuccess,
    onRemoved: noteRemoved,
  });

  if (!role) return null;

  const isProtected = role.isProtected;

  return (
    <>
      <Dialog open={open} busy={isLoading} onOpenChange={changeOpen}>
        <DialogContent data-testid="delete-role-dialog" onCloseAutoFocus={focusLanding}>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>
              {isProtected ? t('descriptionProtected') : t('descriptionConfirm')}
            </DialogDescription>
          </DialogHeader>

          <RoleDeletionSummary role={role} />

          <FormRootError error={refusal.alert} className="mb-0" testId="delete-role-error" />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => changeOpen(false)}
              busy={isLoading}
              data-testid="cancel-button"
            >
              {t('cancel')}
            </Button>
            {!isProtected && (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                busy={isLoading}
                aria-busy={isLoading}
                data-testid="delete-role-button"
              >
                {isLoading ? t('deleting') : t('confirm')}
              </Button>
            )}
          </DialogFooter>
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
