'use client';

import { ROLE_NAME_LENGTHS } from '../../utils/roleFormValidation';
import { RoleCodePreview, describedBy } from './RoleCodePreview';
import { RoleAudienceField } from './RoleAudienceField';
import { useCreateRoleDialog } from '@/modules/permissions/hooks/useCreateRoleDialog';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FieldError, FormRootError, SubmitButton } from '@/components/forms';
import { PermissionSelector } from '../selector/PermissionSelector';
import { FREE_TEXT_FIELD_CLASSES } from '../../constants/freeText';

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
  const model = useCreateRoleDialog({ open, onOpenChange, onSuccess });
  const {
    t,
    operation,
    refusal,
    isLoading,
    handleOpenChange,
    handleCancel,
    handleSubmit,
    audienceId,
    audienceHintId,
    audienceErrorId,
    audience,
    errors,
    setAudience,
    setErrors,
  } = model;
  return (
    <>
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
              <RoleNameField model={model} />
              <RoleDescriptionField model={model} />
              <RoleAudienceField
                id={audienceId}
                hintId={audienceHintId}
                errorId={audienceErrorId}
                value={audience}
                error={errors.audience}
                busy={isLoading}
                onChange={(next) => {
                  setAudience(next);
                  if (errors.audience) setErrors((previous) => ({ ...previous, audience: '' }));
                }}
              />

              <RolePermissionsField model={model} />
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

type CreateModel = ReturnType<typeof useCreateRoleDialog>;

function RoleNameField({ model }: { model: CreateModel }) {
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
    </>
  );
}

function RoleDescriptionField({ model }: { model: CreateModel }) {
  const {
    t,
    descriptionId,
    descriptionErrorId,
    description,
    setDescription,
    errors,
    setErrors,
    isLoading,
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
    </>
  );
}

function RolePermissionsField({ model }: { model: CreateModel }) {
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
    </>
  );
}
