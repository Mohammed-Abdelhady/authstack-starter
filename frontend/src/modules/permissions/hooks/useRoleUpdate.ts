import { useEffect, useRef, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import type { Role } from '@/modules/roles/types';
import { useUpdateRoleMutation } from '@/modules/roles/api/rolesApi';
import type { EditRoleFormValues } from '../components/roles/EditRoleForm';
import { useStaffOperation } from '@/modules/auth/hooks/useStaffOperation';
import { useStaffDialogIntent } from '@/modules/auth/hooks/useStaffDialogIntent';
import { requireObservedVersion } from '@/modules/auth/utils/observedVersion';
import { showsOwnRefusal } from '@/lib/refusal';
import { toast } from '@/lib/toast';
import { reportUnlessHandled } from '@/lib/requestFailure';

interface Options {
  open: boolean;
  role: Role | null;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (() => void) | undefined;
}
interface Context {
  options: Options;
  operation: ReturnType<typeof useStaffOperation>;
  intent: ReturnType<typeof useStaffDialogIntent>;
  update: ReturnType<typeof useUpdateRoleMutation>[0];
  t: ReturnType<typeof useTranslations>;
  submissionInFlight: RefObject<boolean>;
  isLoading: boolean;
}

async function saveRole(
  data: EditRoleFormValues,
  showRefusal: (error: unknown) => void,
  context: Context,
) {
  const { role, open, onOpenChange, onSuccess } = context.options;
  if (!open || !role || context.submissionInFlight.current || context.isLoading) return;
  context.submissionInFlight.current = true;
  const isBaseRole = role.slug === 'admin' || role.slug === 'user';
  const update = isBaseRole
    ? { permissions: data.permissions }
    : {
        name: data.name.trim(),
        description: data.description.trim() || undefined,
        permissions: data.permissions,
      };
  try {
    await context.operation.start({
      isCurrent: context.intent.capture(),
      run: () =>
        showsOwnRefusal(
          context.update({
            idOrSlug: role.id,
            data: { ...update, version: requireObservedVersion(role.version) },
          }),
        ).unwrap(),
      onSuccess: () => {
        toast.success(context.t('updateSuccess', { name: data.name.trim() || role.name }));
        context.intent.invalidate();
        onOpenChange(false);
        onSuccess?.();
      },
      onError: (error) => {
        showRefusal(error);
        reportUnlessHandled(error);
      },
    });
  } finally {
    context.submissionInFlight.current = false;
  }
}

export function useRoleUpdate(options: Options) {
  const t = useTranslations('roles.form');
  const [update] = useUpdateRoleMutation();
  const operation = useStaffOperation();
  const { cancelProof } = operation;
  const intent = useStaffDialogIntent(options.open, options.role?.id ?? null);
  const isLoading = operation.busy || operation.methods !== null;
  const submissionInFlight = useRef(false);
  useEffect(() => {
    cancelProof();
  }, [options.open, options.role?.id, cancelProof]);
  const context = { options, t, update, operation, intent, isLoading, submissionInFlight };
  return {
    operation,
    isLoading,
    invalidate: intent.invalidate,
    submissionInFlight,
    handleSubmit: (data: EditRoleFormValues, show: (error: unknown) => void) =>
      saveRole(data, show, context),
  };
}
