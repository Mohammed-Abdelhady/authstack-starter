'use client';

import {
  ROLE_NAME_LENGTHS,
  firstInvalidRoleField,
  validateRoleForm,
} from '../../utils/roleFormValidation';
import { RoleCodePreview, describedBy, previewedRoleCode } from './RoleCodePreview';
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FieldError, FormRootError, SubmitButton } from '@/components/forms';
import { PermissionSelector } from '../selector/PermissionSelector';
import { FREE_TEXT_FIELD_CLASSES } from '../../constants/freeText';
import type { Role } from '../../api/rolesApi';
import { useFormRefusal } from '@/hooks/useFormRefusal';
import { fieldElementId, useLocalFieldTarget } from '@/hooks/useServerFieldErrors';

export interface EditRoleFormValues {
  name: string;
  description: string;
  permissions: string[];
}

export interface EditRoleFormProps {
  role: Role;
  isLoading: boolean;
  /** `showRefusal` shows a refused save on the field it names, or in the form's alert. */
  onSubmit: (data: EditRoleFormValues, showRefusal: (error: unknown) => void) => void;
  onCancel: () => void;
}

/**
 * Body of the edit dialog. It remounts when the role changes through a key prop,
 * so the fields start from the role that is being edited.
 */
function useEditRoleForm({ role, isLoading, onSubmit }: EditRoleFormProps) {
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

  const [name, setName] = useState(role.name || '');
  const [description, setDescription] = useState(role.description || '');
  const [permissions, setPermissions] = useState<string[]>(role.permissions || []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const refusal = useFormRefusal(useLocalFieldTarget(setErrors, uid), isLoading);

  const isProtected = role.isProtected;
  const isBaseRole = role.slug === 'user' || role.slug === 'admin';
  const canRename = !isProtected && !isBaseRole;
  const code = previewedRoleCode(name);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    const nextErrors = validateRoleForm(
      { name, description, permissions, nameIsEditable: canRename },
      t,
    );

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      // The first field with a problem takes the focus, not whichever had it.
      const invalid = firstInvalidRoleField(nextErrors);
      if (invalid) document.getElementById(fieldElementId(uid, invalid))?.focus();
      return;
    }

    refusal.clear();
    onSubmit({ name, description, permissions }, refusal.show);
  };

  return {
    t,
    nameId,
    nameErrorId,
    nameHintId,
    nameCodeId,
    descriptionId,
    descriptionErrorId,
    permissionsLabelId,
    permissionsErrorId,
    name,
    setName,
    description,
    setDescription,
    permissions,
    setPermissions,
    errors,
    setErrors,
    refusal,
    isProtected,
    isBaseRole,
    canRename,
    code,
    handleSubmit,
    isLoading,
  };
}

type EditModel = ReturnType<typeof useEditRoleForm>;

function RoleEditName({ model }: { model: EditModel }) {
  const {
    t,
    nameId,
    nameErrorId,
    nameHintId,
    nameCodeId,
    name,
    setName,
    errors,
    setErrors,
    code,
    isLoading,
    canRename,
    isProtected,
    isBaseRole,
  } = model;
  return (
    <>
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
          disabled={isProtected || isBaseRole}
          busy={isLoading}
          required
          aria-invalid={Boolean(errors.name)}
          aria-describedby={describedBy(
            canRename && nameHintId,
            canRename && code !== '' && nameCodeId,
            Boolean(errors.name) && nameErrorId,
          )}
          className={FREE_TEXT_FIELD_CLASSES}
          data-testid="edit-role-name-input"
        />
        {canRename && (
          <p id={nameHintId} className="text-xs text-tertiary" data-testid="edit-role-name-hint">
            {t('nameHint', ROLE_NAME_LENGTHS)}
          </p>
        )}
        {canRename && (
          <RoleCodePreview id={nameCodeId} code={code} testId="edit-role-code-preview" />
        )}
        <FieldError id={nameErrorId} message={errors.name} testId="edit-role-name-error" />
        {(isProtected || isBaseRole) && (
          <p className="text-xs text-tertiary">
            {isBaseRole ? t('baseRoleNameImmutable') : t('protectedRoleNameImmutable')}
          </p>
        )}
      </div>
    </>
  );
}

function RoleEditDescription({ model }: { model: EditModel }) {
  const {
    t,
    descriptionId,
    descriptionErrorId,
    description,
    setDescription,
    errors,
    setErrors,
    isLoading,
    isBaseRole,
  } = model;
  return (
    <>
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
          disabled={isBaseRole}
          busy={isLoading}
          aria-invalid={Boolean(errors.description)}
          aria-describedby={errors.description ? descriptionErrorId : undefined}
          className={FREE_TEXT_FIELD_CLASSES}
          data-testid="edit-role-description-input"
        />
        <FieldError
          id={descriptionErrorId}
          message={errors.description}
          testId="edit-role-description-error"
        />
        {isBaseRole && <p className="text-xs text-tertiary">{t('baseRoleDescriptionImmutable')}</p>}
      </div>
    </>
  );
}

function RoleEditPermissions({ model }: { model: EditModel }) {
  const {
    t,
    permissionsLabelId,
    permissionsErrorId,
    permissions,
    setPermissions,
    errors,
    setErrors,
    isLoading,
  } = model;
  return (
    <>
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
              if (errors.permissions) setErrors((prev) => ({ ...prev, permissions: '' }));
            }}
            busy={isLoading}
          />
        </div>
        <FieldError
          id={permissionsErrorId}
          message={errors.permissions}
          testId="edit-role-permissions-error"
        />
      </div>
    </>
  );
}

export function EditRoleForm(props: EditRoleFormProps) {
  const model = useEditRoleForm(props);
  const { role, isLoading, onCancel } = props;
  const { t, handleSubmit, refusal, isBaseRole, isProtected } = model;
  return (
    <form onSubmit={handleSubmit} noValidate>
      <DialogHeader>
        <DialogTitle>{t('editTitle', { name: role.name })}</DialogTitle>
        <DialogDescription>{t('editDescription')}</DialogDescription>
      </DialogHeader>

      <div className="space-y-6 py-6">
        <FormRootError error={refusal.alert} className="mb-0" testId="edit-role-error" />
        {isBaseRole && (
          <Alert variant="infoSoft" role="note" data-testid="base-role-note">
            <AlertDescription>
              <strong>{t('baseRoleAlertTitle')}</strong> {t('baseRoleAlert')}
            </AlertDescription>
          </Alert>
        )}

        {isProtected && !isBaseRole && (
          <Alert variant="warningSoft" role="note" data-testid="protected-role-note">
            <AlertDescription>
              <strong>{t('protectedRoleAlertTitle')}</strong> {t('protectedRoleAlert')}
            </AlertDescription>
          </Alert>
        )}

        <RoleEditName model={model} />
        <RoleEditDescription model={model} />
        <RoleEditPermissions model={model} />
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          busy={isLoading}
          data-testid="cancel-button"
        >
          {t('cancel')}
        </Button>
        <SubmitButton
          isLoading={isLoading}
          loadingText={t('updating')}
          className="h-10 mt-0 w-auto py-2"
          testId="save-role-button"
        >
          {t('update')}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}
