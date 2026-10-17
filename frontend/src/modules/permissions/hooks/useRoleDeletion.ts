import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import type { Role } from '@/modules/roles/types';
import { useDeleteRoleMutation } from '@/modules/roles/api/rolesApi';
import { useStaffOperation } from '@/modules/auth/hooks/useStaffOperation';
import { useStaffDialogIntent } from '@/modules/auth/hooks/useStaffDialogIntent';
import { requireObservedVersion } from '@/modules/auth/utils/observedVersion';
import { toast } from '@/lib/toast';
import { reportUnlessHandled } from '@/lib/requestFailure';
import { useDialogRefusal } from '@/hooks/useFormRefusal';
import { showsOwnRefusal } from '@/lib/refusal';

interface Options {
  open: boolean;
  role: Role | null;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (() => void) | undefined;
  onRemoved: () => void;
}

export function useRoleDeletion(options: Options) {
  const { open, role, onOpenChange, onSuccess, onRemoved } = options;
  const t = useTranslations('roles.delete');
  const [remove] = useDeleteRoleMutation();
  const operation = useStaffOperation();
  const { cancelProof } = operation;
  const intent = useStaffDialogIntent(open, role?.id ?? null);
  const isLoading = operation.busy || operation.methods !== null;
  const refusal = useDialogRefusal();
  useEffect(() => {
    cancelProof();
  }, [open, role?.id, cancelProof]);
  const changeOpen = (next: boolean) => {
    if (!next) {
      intent.invalidate();
      operation.cancelProof();
      refusal.clear();
    }
    onOpenChange(next);
  };
  const handleDelete = async () => {
    if (!open || !role || isLoading) return;
    refusal.clear();
    await operation.start({
      isCurrent: intent.capture(),
      run: () =>
        showsOwnRefusal(
          remove({
            idOrSlug: role.id,
            version: requireObservedVersion(role.version),
          }),
        ).unwrap(),
      onSuccess: () => {
        toast.success(t('success'));
        onRemoved();
        intent.invalidate();
        onOpenChange(false);
        onSuccess?.();
      },
      onError: (error) => {
        refusal.show(error);
        reportUnlessHandled(error);
      },
    });
  };
  return { t, operation, isLoading, refusal, changeOpen, handleDelete };
}
