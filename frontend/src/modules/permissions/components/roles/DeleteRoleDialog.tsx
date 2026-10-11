'use client';

import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useDeleteRoleMutation, type Role } from '../../api/rolesApi';
import { toast } from '@/lib/toast';
import { reportUnlessHandled } from '@/lib/requestFailure';
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
  const t = useTranslations('roles.delete');
  const [deleteRole, { isLoading }] = useDeleteRoleMutation();
  const { noteRemoved, focusLanding } = useRemovalFocus(landing);

  const handleDelete = async () => {
    if (!role) return;

    try {
      await deleteRole(role.id).unwrap();

      toast.success(t('success'));
      noteRemoved();

      // Close dialog
      onOpenChange(false);

      // Call success callback
      onSuccess?.();
    } catch (error) {
      reportUnlessHandled(error);
    }
  };

  if (!role) return null;

  const isProtected = role.isProtected;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="delete-role-dialog" onCloseAutoFocus={focusLanding}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {isProtected ? t('descriptionProtected') : t('descriptionConfirm')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {isProtected ? (
            <Alert variant="warningSoft" role="note">
              <AlertDescription>
                <strong>{t('protectedTitle')}</strong>{' '}
                {t.rich('protectedNotice', {
                  name: role.name,
                  strong: (chunks) => (
                    <strong>
                      <span dir="auto">{chunks}</span>
                    </strong>
                  ),
                })}
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-muted p-4 [overflow-wrap:anywhere]">
                <dl className="space-y-2">
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">{t('roleName')}</dt>
                    <dd className="mt-1 text-sm text-foreground">
                      <span dir="auto" data-testid="delete-role-name">
                        {role.name}
                      </span>
                    </dd>
                  </div>
                  {role.description && (
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">
                        {t('description')}
                      </dt>
                      <dd className="mt-1 text-sm text-foreground">
                        <span dir="auto">{role.description}</span>
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">
                      {t('permissions')}
                    </dt>
                    <dd className="mt-1 text-sm text-foreground">
                      {t('permissionsCount', { count: role.permissions.length })}
                    </dd>
                  </div>
                </dl>
              </div>

              <Alert variant="destructiveSoft" role="note">
                <AlertDescription>
                  <strong>{t('warningTitle')}</strong> {t('warningNotice')}
                </AlertDescription>
              </Alert>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
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
  );
}
