'use client';

import { useCallback, useMemo, useState } from 'react';
import { FormProvider } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { z } from 'zod/v3';
import { ErrorCode } from '@app/core';
import { RefreshCw } from 'lucide-react';
import { useFormWithValidation } from '@/hooks/useFormWithValidation';
import { FormPassword, FormRootError, SubmitButton } from '@/components/forms';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useFeatureDisabledHandler } from '@/modules/auth/hooks/useFeatureDisabled';
import { useRefusalText } from '@/hooks/useRefusalText';
import { showsOwnRefusal } from '@/lib/refusal';
import { useRegenerateRecoveryCodesMutation } from '../api';
import { TOTP_CODE_LENGTH } from '../constants';
import { CodeField } from './CodeField';
import { RecoveryCodeList } from './RecoveryCodeList';
import { useSingleFlight } from '@/hooks/useSingleFlight';
import { HiddenUsernameField } from '@/modules/auth/components/HiddenUsernameField';
import { useTwoFactorLockCountdown } from '@/modules/auth/hooks/useTwoFactorLockCountdown';
import { translatableErrorCode } from '@/modules/auth/utils/errorCodeMessage';

interface RegenerateCodesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasPassword?: boolean;
}

const createSchema = (t: (key: string) => string, passwordRequired: string | undefined) =>
  z.object({
    code: z.string().regex(new RegExp(`^\\d{${TOTP_CODE_LENGTH}}$`), t('codeLength')),
    password:
      passwordRequired === undefined ? z.string().optional() : z.string().min(1, passwordRequired),
  });

type RegenerateFormData = z.infer<ReturnType<typeof createSchema>>;

/**
 * Issues a fresh batch of recovery codes and drops the old one, used or not.
 * The new codes show once, here.
 */
export function RegenerateCodesDialog({
  open,
  onOpenChange,
  hasPassword = false,
}: RegenerateCodesDialogProps) {
  const t = useTranslations('settings.twoFactor.regenerate');
  const tPassword = useTranslations('settings.password');
  const tCommon = useTranslations('common');
  const tAnswer = useTranslations('auth.twoFactor');
  const refusalText = useRefusalText();
  const [regenerate, { isLoading }] = useRegenerateRecoveryCodesMutation();
  const handleFeatureDisabled = useFeatureDisabledHandler();
  const { isCooling, secondsLeft, startForError } = useTwoFactorLockCountdown();
  const [codes, setCodes] = useState<string[] | null>(null);

  const schema = useMemo(
    () => createSchema(tAnswer, hasPassword ? tPassword('currentPasswordRequired') : undefined),
    [hasPassword, tAnswer, tPassword],
  );
  const form = useFormWithValidation({
    schema,
    defaultValues: { code: '', password: '' },
    mode: 'onSubmit',
  });

  const {
    handleSubmit,
    formState: { errors },
    setError,
    reset,
  } = form;

  const submit = useCallback(
    async (data: RegenerateFormData) => {
      if (isCooling) return;
      try {
        const request =
          data.password === undefined || data.password.length === 0
            ? { code: data.code }
            : { code: data.code, password: data.password };
        const result = await showsOwnRefusal(regenerate(request)).unwrap();
        setCodes(result.recoveryCodes);
      } catch (err) {
        if (handleFeatureDisabled(err)) {
          return;
        }
        if (startForError(err)) return;
        const message =
          translatableErrorCode(err) === ErrorCode.TWO_FACTOR_LOCKED
            ? t('locked')
            : refusalText(err);
        setError('root', { type: 'manual', message });
      }
    },
    [handleFeatureDisabled, isCooling, startForError, refusalText, regenerate, setError, t],
  );
  const onSubmit = useSingleFlight(submit);

  const onDone = useCallback(() => {
    setCodes(null);
    reset();
    onOpenChange(false);
  }, [onOpenChange, reset]);

  // Once the new codes are on screen they exist nowhere else, so only Done
  // dismisses the dialog.
  const onDialogOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        onOpenChange(true);
        return;
      }
      if (codes === null) {
        onDone();
      }
    },
    [codes, onDone, onOpenChange],
  );

  return (
    <Dialog open={open} busy={isLoading} onOpenChange={onDialogOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="two-factor-regenerate-dialog"
        showCloseButton={codes === null}
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{codes === null ? t('description') : t('done')}</DialogDescription>
        </DialogHeader>

        {codes === null ? (
          <FormProvider {...form}>
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="space-y-4"
              data-testid="two-factor-regenerate-form"
              noValidate
            >
              <FormRootError
                id="two-factor-regenerate-error"
                error={
                  isCooling ? t('lockedCountdown', { seconds: secondsLeft }) : errors.root?.message
                }
                testId="two-factor-regenerate-error"
              />

              {hasPassword && <HiddenUsernameField />}
              {hasPassword && (
                <FormPassword<RegenerateFormData>
                  name="password"
                  label={tPassword('currentPassword')}
                  placeholder={tCommon('passwordPlaceholder')}
                  autoComplete="current-password"
                  required
                  busy={isLoading}
                  data-testid="two-factor-regenerate-password"
                />
              )}

              <CodeField<RegenerateFormData>
                name="code"
                label={tAnswer('code')}
                busy={isLoading}
                autoFocus={!hasPassword}
                testId="two-factor-regenerate-code"
              />

              <SubmitButton
                isLoading={isLoading}
                disabled={isCooling}
                icon={RefreshCw}
                className="h-10 mt-0 w-full py-2"
                testId="two-factor-regenerate-submit"
              >
                {t('submit')}
              </SubmitButton>
            </form>
          </FormProvider>
        ) : (
          <div className="space-y-4">
            <RecoveryCodeList codes={codes} />
            <Button
              type="button"
              className="w-full"
              onClick={onDone}
              data-testid="two-factor-regenerate-done"
            >
              {t('close')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
