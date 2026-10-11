'use client';

import { useId, useState } from 'react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { FieldError, PasswordVisibilityToggle, SubmitButton } from '@/components/forms';
import { useCreateUserMutation } from '@/store/api/userApi';
import { useListRolesQuery } from '../../api/rolesApi';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { reportUnlessHandled } from '@/lib/requestFailure';
import { useRefusalToast } from '@/hooks/useRefusalToast';
import { FREE_TEXT_FIELD_CLASSES } from '../../constants/freeText';
import { validateCreateUserForm } from '../../utils/createUserValidation';
import { TruncatedText } from '../shared/TruncatedText';
import {
  fieldElementId,
  useLocalFieldTarget,
  useServerFieldErrors,
} from '@/hooks/useServerFieldErrors';

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
 * - Role selector (non-protected roles only)
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
  const [role, setRole] = useState('user');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [createUser, { isLoading }] = useCreateUserMutation();
  const refusalToast = useRefusalToast();
  const { data: rolesData, isLoading: isLoadingRoles } = useListRolesQuery(undefined);

  const roles = rolesData?.roles || [];
  const availableRoles = roles.filter((r) => !r.isProtected);
  const selectedRole = availableRoles.find((r) => r.slug === role);

  const applyServerFieldErrors = useServerFieldErrors(
    useLocalFieldTarget(setErrors, uid),
    isLoading,
  );

  const validateForm = (): boolean => {
    const newErrors = validateCreateUserForm(
      { email, name, password, role },
      tValidation,
      tPassword,
    );
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    refusalToast.clearStale();
    try {
      await createUser({
        email: email.trim(),
        name: name.trim(),
        password,
        role,
      }).unwrap();

      toast.success(t('success'));
      handleClose();
      onSuccess?.();
    } catch (error) {
      refusalToast.noteRefusal();
      // A dialog that was closed in the meantime has no fields left to mark.
      applyServerFieldErrors(error);
      reportUnlessHandled(error);
    }
  };

  const handleClose = () => {
    setEmail('');
    setName('');
    setPassword('');
    setRole('user');
    setShowPassword(false);
    setErrors({});
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : handleClose())}>
      <DialogContent className="sm:max-w-[500px]" data-testid="create-user-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {/* Email Field */}
          <div className="space-y-2">
            <Label
              htmlFor={fieldId('email')}
              className="text-xs uppercase tracking-widest text-muted-foreground"
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
              disabled={isLoading}
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
              className="text-xs uppercase tracking-widest text-muted-foreground"
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
              disabled={isLoading}
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
              className="text-xs uppercase tracking-widest text-muted-foreground"
            >
              {t('password')}
            </Label>
            <div className="relative">
              <Input
                id={fieldId('password')}
                type={showPassword ? 'text' : 'password'}
                placeholder={tCommon('passwordPlaceholder')}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errors.password) setErrors((prev) => ({ ...prev, password: '' }));
                }}
                disabled={isLoading}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? errorId('password') : undefined}
                className={errors.password ? 'border-destructive pe-10' : 'pe-10'}
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
              className="text-xs uppercase tracking-widest text-muted-foreground"
            >
              {t('role')}
            </Label>
            <Select
              value={role}
              onValueChange={(value) => {
                setRole(value);
                if (errors.role) setErrors((prev) => ({ ...prev, role: '' }));
              }}
              disabled={isLoading || isLoadingRoles}
            >
              <SelectTrigger
                id={fieldId('role')}
                aria-invalid={Boolean(errors.role)}
                aria-describedby={errors.role ? errorId('role') : undefined}
                className={errors.role ? 'border-destructive' : ''}
                data-testid="create-user-role-select"
              >
                {isLoadingRoles ? (
                  <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
                ) : (
                  <SelectValue placeholder={t('selectRole')}>
                    {/* One line, cut at the end of the name. The list shows it whole. */}
                    {selectedRole ? (
                      <span className="flex min-w-0">
                        <TruncatedText value={selectedRole.name} dir="auto" />
                      </span>
                    ) : undefined}
                  </SelectValue>
                )}
              </SelectTrigger>
              <SelectContent>
                {availableRoles.map((r) => (
                  <SelectItem key={r.id} value={r.slug} data-testid={`role-option-${r.slug}`}>
                    <div className="flex items-center gap-2">
                      <span dir="auto">{r.name}</span>
                      {r.isSystemRole && (
                        <span className="text-xs text-tertiary">{t('systemRole')}</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError id={errorId('role')} message={errors.role} testId="role-error" />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={isLoading}
              data-testid="cancel-create-user-button"
            >
              {tCommon('cancel')}
            </Button>
            <SubmitButton
              isLoading={isLoading}
              loadingText={t('creating')}
              className="h-10 mt-0 w-auto py-2"
              testId="submit-create-user-button"
            >
              {t('submit')}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
