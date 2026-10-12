'use client';

import {
  ROLE_NAME_LENGTHS,
  firstInvalidRoleField,
  validateRoleForm,
} from '../../utils/roleFormValidation';
import { RoleCodePreview, describedBy, previewedRoleCode } from './RoleCodePreview';
import { useId, useRef, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FieldError, FormRootError, SubmitButton } from '@/components/forms';
import { useCreateRoleMutation } from '../../api/rolesApi';
import { PermissionSelector } from '../selector/PermissionSelector';
import { FREE_TEXT_FIELD_CLASSES } from '../../constants/freeText';
import { useFormRefusal } from '@/hooks/useFormRefusal';
import { showsOwnRefusal } from '@/lib/refusal';
import { toast } from '@/lib/toast';
import { reportUnlessHandled } from '@/lib/requestFailure';
import { fieldElementId, useLocalFieldTarget } from '@/hooks/useServerFieldErrors';

export interface CreateRoleDialogProps {
  /**
   * Whether the dialog is open
   */
  open: boolean;

  /**
   * Callback when dialog should close
   */
  onOpenChange: (open: boolean) => void;

  /**
   * Callback when role is successfully created
   */
  onSuccess?: () => void;
}

/**
 * Dialog for creating a new role. Validation problems are shown under the field
 * they belong to and linked with `aria-describedby`, not only as a toast.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 *
 * <CreateRoleDialog open={open} onOpenChange={setOpen} onSuccess={refetch} />
 * ```
 */
export function CreateRoleDialog({ open, onOpenChange, onSuccess }: CreateRoleDialogProps) {
  const t = useTranslations('roles.form');
  const uid = useId();
  const nameId = fieldElementId(uid, 'name');
  const nameErrorId = `${nameId}-error`;
  const nameHintId = `${nameId}-hint`;
  const nameCodeId = `${nameId}-code`;
  const descriptionId = fieldElementId(uid, 'description');
  const descriptionErrorId = `${descriptionId}-error`;
  const permissionsLabelId = `${uid}-permissions-label`;
  const permissionsErrorId = `${uid}-permissions-error`;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submissionInFlight = useRef(false);

  const code = previewedRoleCode(name);

  const [createRole, { isLoading }] = useCreateRoleMutation();
  const refusal = useFormRefusal(useLocalFieldTarget(setErrors, uid), isLoading);

  const resetForm = () => {
    setName('');
    setDescription('');
    setPermissions([]);
    setErrors({});
    refusal.clear();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submissionInFlight.current) return;

    const nextErrors = validateRoleForm({ name, description, permissions }, t);

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      // The first field with a problem takes the focus, not whichever had it.
      const invalid = firstInvalidRoleField(nextErrors);
      if (invalid) document.getElementById(fieldElementId(uid, invalid))?.focus();
      return;
    }

    submissionInFlight.current = true;
    refusal.clear();
    try {
      await showsOwnRefusal(
        createRole({
          name: name.trim(),
          description: description.trim() || undefined,
          permissions,
        }),
      ).unwrap();

      toast.success(t('createSuccess', { name: name.trim() }));
      resetForm();
      submissionInFlight.current = false;
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      refusal.show(error);
      reportUnlessHandled(error);
    } finally {
      submissionInFlight.current = false;
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      if (submissionInFlight.current) return;
      resetForm();
    }
    onOpenChange(nextOpen);
  };

  const handleCancel = () => {
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} busy={isLoading} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-3xl overflow-y-auto"
        data-testid="create-role-dialog"
      >
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('createTitle')}</DialogTitle>
            <DialogDescription>{t('createDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-6">
            <FormRootError error={refusal.alert} className="mb-0" testId="create-role-error" />
            {/* Role Name */}
            <div className="space-y-2">
              <Label htmlFor={nameId}>
                {t('nameLabel')} <span className="text-destructive">{t('nameRequired')}</span>
              </Label>
              <Input
                id={nameId}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
                }}
                placeholder={t('namePlaceholder')}
                busy={isLoading}
                required
                aria-invalid={Boolean(errors.name)}
                aria-describedby={describedBy(
                  nameHintId,
                  code !== '' && nameCodeId,
                  Boolean(errors.name) && nameErrorId,
                )}
                className={FREE_TEXT_FIELD_CLASSES}
                data-testid="role-name-input"
              />
              <p id={nameHintId} className="text-xs text-tertiary" data-testid="role-name-hint">
                {t('nameHint', ROLE_NAME_LENGTHS)}
              </p>
              <RoleCodePreview id={nameCodeId} code={code} testId="role-code-preview" />
              <FieldError id={nameErrorId} message={errors.name} testId="role-name-error" />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor={descriptionId}>{t('descriptionLabel')}</Label>
              <Textarea
                id={descriptionId}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (errors.description) setErrors((prev) => ({ ...prev, description: '' }));
                }}
                placeholder={t('descriptionPlaceholder')}
                rows={3}
                busy={isLoading}
                aria-invalid={Boolean(errors.description)}
                aria-describedby={errors.description ? descriptionErrorId : undefined}
                className={FREE_TEXT_FIELD_CLASSES}
                data-testid="role-description-input"
              />
              <FieldError
                id={descriptionErrorId}
                message={errors.description}
                testId="role-description-error"
              />
            </div>

            {/* Permissions */}
            <div className="space-y-2">
              <Label id={permissionsLabelId}>
                {t('permissionsLabel')}{' '}
                <span className="text-destructive">{t('permissionsRequired')}</span>
              </Label>
              <div
                role="group"
                aria-labelledby={permissionsLabelId}
                aria-describedby={errors.permissions ? permissionsErrorId : undefined}
              >
                <PermissionSelector
                  selectedPermissions={permissions}
                  onChange={(next) => {
                    setPermissions(next);
                    if (errors.permissions) {
                      setErrors((prev) => ({ ...prev, permissions: '' }));
                    }
                  }}
                  busy={isLoading}
                />
              </div>
              <FieldError
                id={permissionsErrorId}
                message={errors.permissions}
                testId="role-permissions-error"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              busy={isLoading}
              data-testid="cancel-button"
            >
              {t('cancel')}
            </Button>
            <SubmitButton
              isLoading={isLoading}
              loadingText={t('creating')}
              className="h-10 mt-0 w-auto py-2"
              testId="create-role-button"
            >
              {t('create')}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
