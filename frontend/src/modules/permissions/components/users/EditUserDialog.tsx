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
import { Loader2 } from 'lucide-react';
import { useUpdateUserMutation } from '@/store/api/userApi';
import { toast } from '@/lib/toast';
import { reportUnlessHandled } from '@/lib/requestFailure';
import { useRefusalToast } from '@/hooks/useRefusalToast';
import {
  fieldElementId,
  useLocalFieldTarget,
  useServerFieldErrors,
} from '@/hooks/useServerFieldErrors';
import { zodName } from '@app/core';
import { cn } from '@/lib/utils';
import { FREE_TEXT_FIELD_CLASSES } from '../../constants/freeText';

interface EditUserDialogProps {
  userId: string | null;
  currentName: string;
  currentEmail: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs when the dialog has closed, to put focus back on what opened it */
  onCloseAutoFocus?: (event: Event) => void;
}

interface EditUserFormValues {
  /** Present only when the admin changed the name. */
  name?: string;
  email: string;
}

interface EditUserFormProps {
  initialName: string;
  initialEmail: string;
  isLoading: boolean;
  onSubmit: (data: EditUserFormValues, onRejected: (error: unknown) => void) => Promise<boolean>;
  onClose: () => void;
}

/**
 * Inner form component - remounts when userId changes via key prop
 */
function EditUserForm({
  initialName,
  initialEmail,
  isLoading,
  onSubmit,
  onClose,
}: EditUserFormProps) {
  const t = useTranslations('users.editUser');
  // Initialize directly from props - component remounts when userId changes
  const [name, setName] = useState(initialName || '');
  const [email, setEmail] = useState(initialEmail || '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const uid = useId();
  const fieldId = (field: keyof EditUserFormValues) => fieldElementId(uid, field);
  const errorId = (field: keyof EditUserFormValues) => `${fieldId(field)}-error`;

  const applyServerFieldErrors = useServerFieldErrors(
    useLocalFieldTarget(setErrors, uid),
    isLoading,
  );

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!email.trim()) {
      newErrors.email = t('errors.emailRequired');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = t('errors.emailInvalid');
    }

    // Provider names stored before this rule must not block email-only edits.
    if (name !== initialName) {
      const nameResult = zodName({
        required: true,
        messages: {
          required: t('errors.nameRequired'),
          min: t('errors.nameMinLength'),
          max: t('errors.nameMaxLength'),
          pattern: t('errors.namePattern'),
          noLetter: t('errors.nameNoLetter'),
        },
      }).safeParse(name);
      if (!nameResult.success) {
        newErrors.name = nameResult.error.issues[0].message;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    const nameChanged = name !== initialName;
    const success = await onSubmit(
      {
        email: email.trim(),
        ...(nameChanged ? { name: name.trim().normalize('NFC') } : {}),
      },
      applyServerFieldErrors,
    );
    if (success) {
      onClose();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
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
          busy={isLoading}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? errorId('name') : undefined}
          className={cn(FREE_TEXT_FIELD_CLASSES, errors.name && 'border-destructive')}
          data-testid="edit-user-name-input"
        />
        {errors.name && (
          <p id={errorId('name')} className="text-xs text-destructive" data-testid="name-error">
            {errors.name}
          </p>
        )}
      </div>

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
          busy={isLoading}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? errorId('email') : undefined}
          className={errors.email ? 'border-destructive' : ''}
          data-testid="edit-user-email-input"
        />
        {errors.email && (
          <p id={errorId('email')} className="text-xs text-destructive" data-testid="email-error">
            {errors.email}
          </p>
        )}
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          busy={isLoading}
          data-testid="cancel-edit-user-button"
        >
          {t('cancel')}
        </Button>
        <Button
          type="submit"
          busy={isLoading}
          aria-busy={isLoading}
          data-testid="submit-edit-user-button"
        >
          {isLoading ? (
            <>
              <Loader2 className="me-2 h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
              {t('saving')}
            </>
          ) : (
            t('save')
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * EditUserDialog - Modal for editing user information
 *
 * Features:
 * - Edit user name and email
 * - Form validation
 * - Error handling
 * - Loading states
 *
 * @example
 * ```tsx
 * const [editUserId, setEditUserId] = useState<string | null>(null);
 * <EditUserDialog
 *   userId={editUserId}
 *   currentName="John Doe"
 *   currentEmail="john@example.com"
 *   open={!!editUserId}
 *   onOpenChange={(open) => !open && setEditUserId(null)}
 * />
 * ```
 */
export function EditUserDialog({
  userId,
  currentName,
  currentEmail,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: EditUserDialogProps) {
  const t = useTranslations('users.editUser');
  const [updateUser, { isLoading }] = useUpdateUserMutation();
  const refusalToast = useRefusalToast();

  const handleSubmit = async (
    data: EditUserFormValues,
    onRejected: (error: unknown) => void,
  ): Promise<boolean> => {
    if (!userId) return false;

    // Check if nothing changed
    if ((data.name === undefined || data.name === currentName) && data.email === currentEmail) {
      toast.info(t('noChanges'));
      return true;
    }

    refusalToast.clearStale();
    try {
      await updateUser({
        userId,
        ...(data.name === undefined ? {} : { name: data.name }),
        email: data.email,
      }).unwrap();

      toast.success(t('success'));
      return true;
    } catch (error) {
      refusalToast.noteRefusal();
      onRejected(error);
      reportUnlessHandled(error);
      return false;
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  if (!userId) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[500px]"
        data-testid="edit-user-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {/* Key forces remount when userId changes, reinitializing state */}
        <EditUserForm
          key={userId}
          initialName={currentName}
          initialEmail={currentEmail}
          isLoading={isLoading}
          onSubmit={handleSubmit}
          onClose={handleClose}
        />
      </DialogContent>
    </Dialog>
  );
}
