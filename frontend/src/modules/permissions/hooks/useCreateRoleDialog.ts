import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import type { RoleAudience } from '@app/core';
import { useCreateRoleMutation } from '@/modules/roles/api/rolesApi';
import { useStaffOperation } from '@/modules/auth/hooks/useStaffOperation';
import { useStaffDialogIntent } from '@/modules/auth/hooks/useStaffDialogIntent';
import { useOperationKey } from '@/modules/auth/hooks/useOperationKey';
import { useFormRefusal } from '@/hooks/useFormRefusal';
import { fieldElementId, useLocalFieldTarget } from '@/hooks/useServerFieldErrors';
import { showsOwnRefusal } from '@/lib/refusal';
import { toast } from '@/lib/toast';
import { reportUnlessHandled } from '@/lib/requestFailure';
import { firstInvalidRoleField, validateRoleForm } from '../utils/roleFormValidation';
import { previewedRoleCode } from '../components/roles/RoleCodePreview';

interface Options {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (() => void) | undefined;
}

function useCreateRoleFields() {
  const uid = useId();
  const nameId = fieldElementId(uid, 'name');
  const descriptionId = fieldElementId(uid, 'description');
  const audienceId = fieldElementId(uid, 'audience');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [audience, setAudience] = useState<RoleAudience>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  return {
    uid,
    name,
    setName,
    description,
    setDescription,
    permissions,
    setPermissions,
    audience,
    setAudience,
    errors,
    setErrors,
    nameId,
    nameErrorId: `${nameId}-error`,
    nameHintId: `${nameId}-hint`,
    nameCodeId: `${nameId}-code`,
    descriptionId,
    descriptionErrorId: `${descriptionId}-error`,
    audienceId,
    audienceHintId: `${audienceId}-hint`,
    audienceErrorId: `${audienceId}-error`,
    permissionsLabelId: `${uid}-permissions-label`,
    permissionsErrorId: `${uid}-permissions-error`,
    code: previewedRoleCode(name),
  };
}

interface CreateContext {
  options: Options;
  fields: ReturnType<typeof useCreateRoleFields>;
  t: ReturnType<typeof useTranslations>;
  operation: ReturnType<typeof useStaffOperation>;
  intent: ReturnType<typeof useStaffDialogIntent>;
  key: ReturnType<typeof useOperationKey>;
  refusal: ReturnType<typeof useFormRefusal>;
  create: ReturnType<typeof useCreateRoleMutation>[0];
  inFlight: RefObject<boolean>;
  busy: boolean;
}

function resetFields(context: CreateContext) {
  const fields = context.fields;
  fields.setName('');
  fields.setDescription('');
  fields.setPermissions([]);
  fields.setAudience(undefined);
  fields.setErrors({});
  context.refusal.clear();
  context.key.reset();
}

async function submitRole(event: FormEvent, context: CreateContext) {
  event.preventDefault();
  if (context.inFlight.current || context.busy) return;
  const { name, description, permissions, audience, uid, setErrors } = context.fields;
  const errors = validateRoleForm({ name, description, permissions }, context.t);
  setErrors(errors);
  if (Object.keys(errors).length > 0) {
    const field = firstInvalidRoleField(errors);
    if (field) document.getElementById(fieldElementId(uid, field))?.focus();
    return;
  }
  context.inFlight.current = true;
  context.refusal.clear();
  try {
    const data = {
      name: name.trim(),
      description: description.trim() || undefined,
      permissions,
      ...(audience === undefined ? {} : { audience }),
    };
    const idempotencyKey = context.key.forBody(data);
    await context.operation.start({
      isCurrent: context.intent.capture(),
      run: () => showsOwnRefusal(context.create({ data, idempotencyKey })).unwrap(),
      onSuccess: () => {
        toast.success(context.t('createSuccess', { name: data.name }));
        resetFields(context);
        context.intent.invalidate();
        context.options.onOpenChange(false);
        context.options.onSuccess?.();
      },
      onError: (error) => {
        context.refusal.show(error);
        reportUnlessHandled(error);
      },
    });
  } catch (error) {
    context.refusal.show(error);
    reportUnlessHandled(error);
  } finally {
    context.inFlight.current = false;
  }
}

export function useCreateRoleDialog(options: Options) {
  const fields = useCreateRoleFields();
  const t = useTranslations('roles.form');
  const [create] = useCreateRoleMutation();
  const operation = useStaffOperation();
  const intent = useStaffDialogIntent(options.open, 'create-role');
  const key = useOperationKey();
  const { cancelProof } = operation;
  const { reset: resetKey } = key;
  const inFlight = useRef(false);
  const busy = operation.busy || operation.methods !== null;
  const refusal = useFormRefusal(useLocalFieldTarget(fields.setErrors, fields.uid), busy);
  useEffect(() => {
    if (!options.open) {
      cancelProof();
      resetKey();
    }
    return () => resetKey();
  }, [options.open, cancelProof, resetKey]);
  const context = { options, fields, t, create, operation, intent, key, inFlight, busy, refusal };
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      if (inFlight.current || busy) return;
      intent.invalidate();
      operation.cancelProof();
      resetFields(context);
    }
    options.onOpenChange(nextOpen);
  };
  return {
    ...fields,
    t,
    operation,
    refusal,
    isLoading: busy,
    handleOpenChange,
    handleCancel: () => handleOpenChange(false),
    handleSubmit: (event: FormEvent) => submitRole(event, context),
  };
}
