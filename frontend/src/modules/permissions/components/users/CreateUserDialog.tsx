'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useStaffOperation } from '@/modules/auth/hooks/useStaffOperation';
import { useStaffDialogIntent } from '@/modules/auth/hooks/useStaffDialogIntent';
import { FreshProofDialog } from '@/modules/auth/components/FreshProofDialog';
import { useOperationKey } from '@/modules/auth/hooks/useOperationKey';
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
import {
  FieldError,
  FormRootError,
  PasswordVisibilityToggle,
  SubmitButton,
} from '@/components/forms';
import { useCreateUserMutation } from '@/store/api/userApi';
import { DEFAULT_ROLE_SLUG } from '@/modules/roles/constants';
import { useAllRoles } from '@/modules/roles/hooks/useAllRoles';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { reportUnlessHandled } from '@/lib/requestFailure';
import { useFormRefusal } from '@/hooks/useFormRefusal';
import { showsOwnRefusal } from '@/lib/refusal';
import { FREE_TEXT_FIELD_CLASSES } from '../../constants/freeText';
import { validateCreateUserForm } from '../../utils/createUserValidation';
import { CreateUserRoleField } from './CreateUserRoleField';
import { fieldElementId, useLocalFieldTarget } from '@/hooks/useServerFieldErrors';

export interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional callback when user is created successfully */
  onSuccess?: () => void;
}

/**
 * CreateUserDialog - Modal for creating new users
 *
 * Features:
 * - Email, name, password input fields
 * - Role selector: every role, with the ones this person may not assign held back
 * - Form validation
 * - Error handling
 * - Loading states
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 * <CreateUserDialog open={open} onOpenChange={setOpen} />
 * ```
 */
export function CreateUserDialog({ open, onOpenChange, onSuccess }: CreateUserDialogProps) {
  const t = useTranslations('users.createUser');
  const tValidation = useTranslations('validation');
  const tPassword = useTranslations('auth.passwordRules.errors');
  const tCommon = useTranslations('common');
  const uid = useId();
  const fieldId = (name: string) => fieldElementId(uid, name);
  const errorId = (name: string) => `${fieldId(name)}-error`;
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(DEFAULT_ROLE_SLUG);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submissionInFlight = useRef(false);

  const [createUser, { isLoading: requestLoading }] = useCreateUserMutation();
  const operation = useStaffOperation();
  const intent = useStaffDialogIntent(open, 'create-user');
  const operationKey = useOperationKey();
  const { reset: resetOperationKey } = operationKey;
  const isLoading = requestLoading || operation.busy;
  useEffect(() => {
    if (!open) resetOperationKey();
  }, [open, resetOperationKey]);
  const allRoles = useAllRoles();

  const refusal = useFormRefusal(useLocalFieldTarget(setErrors, uid), isLoading);

  const validateForm = (): boolean => {
    const newErrors = validateCreateUserForm(
      { email, name, password, role },
      tValidation,
      tPassword,
    );
    setErrors(newErrors);
    const firstInvalid = (['email', 'name', 'password', 'role'] as const).find((field) =>
      Boolean(newErrors[field]),
    );
    if (firstInvalid) document.getElementById(fieldId(firstInvalid))?.focus();
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      isLoading ||
      submissionInFlight.current ||
      operation.methods ||
      allRoles.isError ||
      allRoles.isLoading
    )
      return;

    if (!validateForm()) {
      return;
    }

    submissionInFlight.current = true;
    refusal.clear();
    const body = { email: email.trim(), name: name.trim(), password, role };
    const idempotencyKey = operationKey.forBody(body);
    try {
      await operation.start({
        isCurrent: intent.capture(),
        run: () => showsOwnRefusal(createUser({ body, idempotencyKey })).unwrap(),
        onSuccess: () => {
          toast.success(t('success'));
          handleClose();
          onSuccess?.();
        },
        onError: (error) => {
          refusal.show(error);
          reportUnlessHandled(error);
        },
      });
    } finally {
      submissionInFlight.current = false;
    }
  };

  const handleClose = () => {
    intent.invalidate();
    operation.cancelProof();
    operationKey.reset();
    setEmail('');
    setName('');
    setPassword('');
    setRole(DEFAULT_ROLE_SLUG);
    setShowPassword(false);
    setErrors({});
    refusal.clear();
    onOpenChange(false);
  };

  return (
    <>
      {operation.methods && (
        <FreshProofDialog
          methods={operation.methods}
          onProved={operation.proved}
          onCancel={operation.cancelProof}
        />
      )}
      <Dialog
        open={open}
        busy={isLoading}
        onOpenChange={(next) => (next ? onOpenChange(true) : handleClose())}
      >
        <DialogContent className="sm:max-w-[500px]" data-testid="create-user-dialog">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <FormRootError error={refusal.alert} className="mb-0" testId="create-user-error" />
            {/* Email Field */}
            <div className="space-y-2">
              <Label
                htmlFor={fieldId('email')}
                className="text-xs uppercase tracking-widest rtl:tracking-normal text-muted-foreground"
              >
                {t('email')}
              </Label>
              <Input
                id={fieldId('email')}
                type="email"
                dir="ltr"
                placeholder={t('emailPlaceholder')}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (errors.email) setErrors((prev) => ({ ...prev, email: '' }));
                }}
                busy={isLoading}
                required
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? errorId('email') : undefined}
                className={errors.email ? 'border-destructive' : ''}
                data-testid="create-user-email-input"
              />
              <FieldError id={errorId('email')} message={errors.email} testId="email-error" />
            </div>

            {/* Name Field */}
            <div className="space-y-2">
              <Label
                htmlFor={fieldId('name')}
                className="text-xs uppercase tracking-widest rtl:tracking-normal text-muted-foreground"
              >
                {t('name')}
              </Label>
              <Input
                id={fieldId('name')}
                type="text"
                placeholder={t('namePlaceholder')}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
                }}
                busy={isLoading}
                required
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? errorId('name') : undefined}
                className={cn(FREE_TEXT_FIELD_CLASSES, errors.name && 'border-destructive')}
                data-testid="create-user-name-input"
              />
              <FieldError id={errorId('name')} message={errors.name} testId="name-error" />
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <Label
                htmlFor={fieldId('password')}
                className="text-xs uppercase tracking-widest rtl:tracking-normal text-muted-foreground"
              >
                {t('password')}
              </Label>
              <div className="relative">
                <Input
                  id={fieldId('password')}
                  dir="ltr"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={tCommon('passwordPlaceholder')}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errors.password) setErrors((prev) => ({ ...prev, password: '' }));
                  }}
                  busy={isLoading}
                  required
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? errorId('password') : undefined}
                  className={errors.password ? 'border-destructive pe-10' : 'pe-10'}
                  autoComplete="new-password"
                  data-testid="create-user-password-input"
                />
                <PasswordVisibilityToggle
                  showPassword={showPassword}
                  onToggle={() => setShowPassword(!showPassword)}
                  testId="create-user-password-toggle"
                />
              </div>
              <FieldError
                id={errorId('password')}
                message={errors.password}
                testId="password-error"
              />
            </div>

            {/* Role Field */}
            <div className="space-y-2">
              <Label
                htmlFor={fieldId('role')}
                className="text-xs uppercase tracking-widest rtl:tracking-normal text-muted-foreground"
              >
                {t('role')}
              </Label>
              <CreateUserRoleField
                id={fieldId('role')}
                value={role}
                onChange={(value) => {
                  setRole(value);
                  if (errors.role) setErrors((prev) => ({ ...prev, role: '' }));
                }}
                allRoles={allRoles}
                busy={isLoading}
                errorId={errors.role ? errorId('role') : undefined}
              />
              <FieldError id={errorId('role')} message={errors.role} testId="role-error" />
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="ghost"
                onClick={handleClose}
                busy={isLoading}
                data-testid="cancel-create-user-button"
              >
                {tCommon('cancel')}
              </Button>
              <SubmitButton
                isLoading={isLoading}
                busy={isLoading || allRoles.isLoading}
                disabled={allRoles.isError}
                loadingText={t('creating')}
                className="h-10 mt-0 w-auto py-2 rtl:tracking-normal"
                testId="submit-create-user-button"
              >
                {t('submit')}
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
