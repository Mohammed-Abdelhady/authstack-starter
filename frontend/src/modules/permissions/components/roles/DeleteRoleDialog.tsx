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
import { Button } from '@/components/ui/button';
import { useDeleteRoleMutation, type Role } from '../../api/rolesApi';
import { toast } from '@/lib/toast';
import { reportUnlessHandled } from '@/lib/requestFailure';

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
export function DeleteRoleDialog({ open, onOpenChange, role, onSuccess }: DeleteRoleDialogProps) {
  const t = useTranslations('roles.delete');
  const [deleteRole, { isLoading }] = useDeleteRoleMutation();

  const handleDelete = async () => {
    if (!role) return;

    try {
      await deleteRole(role.id).unwrap();

      toast.success(t('success'));

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {isProtected ? t('descriptionProtected') : t('descriptionConfirm')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {isProtected ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
              <p className="text-sm text-amber-900 dark:text-amber-100">
                <strong>{t('protectedTitle')}</strong>{' '}
                {t.rich('protectedNotice', {
                  name: role.name,
                  strong: (chunks) => (
                    <strong>
                      <span dir="auto">{chunks}</span>
                    </strong>
                  ),
                })}
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
                <dl className="space-y-2">
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      {t('roleName')}
                    </dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                      <span dir="auto" data-testid="delete-role-name">
                        {role.name}
                      </span>
                    </dd>
                  </div>
                  {role.description && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                        {t('description')}
                      </dt>
                      <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                        <span dir="auto">{role.description}</span>
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      {t('permissions')}
                    </dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                      {t('permissionsCount', { count: role.permissions.length })}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
                <p className="text-sm text-red-900 dark:text-red-100">
                  <strong>{t('warningTitle')}</strong> {t('warningNotice')}
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
            data-testid="cancel-button"
          >
            {t('cancel')}
          </Button>
          {!isProtected && (
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={isLoading}
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
