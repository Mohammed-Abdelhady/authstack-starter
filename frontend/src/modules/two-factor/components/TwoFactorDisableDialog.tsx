'use client';

import { useCallback, useMemo, useState } from 'react';
import { FormProvider } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { ShieldOff } from 'lucide-react';
import { useFormWithValidation } from '@/hooks/useFormWithValidation';
import { FormPassword, FormRootError, SubmitButton } from '@/components/forms';
import { HiddenUsernameField } from '@/modules/auth/components/HiddenUsernameField';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/lib/toast';
import { useFeatureDisabledHandler } from '@/modules/auth/hooks/useFeatureDisabled';
import { translatableErrorCode } from '@/modules/auth/utils/errorCodeMessage';
import { useDisableTwoFactorMutation } from '../api';
import { createAnswerSchema, toAnswer, type AnswerFormData } from '../utils/answerSchema';
import { TwoFactorAnswerFields } from './TwoFactorAnswerFields';
import { useSingleFlight } from '@/hooks/useSingleFlight';

interface TwoFactorDisableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** True when the account has a password, which the backend also asks for. */
  hasPassword: boolean;
}

type DisableFormData = AnswerFormData & { password?: string };

/** Turns the second factor off. Needs a code or a recovery code either way. */
export function TwoFactorDisableDialog({
  open,
  onOpenChange,
  hasPassword,
}: TwoFactorDisableDialogProps) {
  const t = useTranslations('settings.twoFactor.disable');
  const tCommon = useTranslations('common');
  const tCodes = useTranslations('errors.codes');
  const tAnswer = useTranslations('auth.twoFactor');
  const [disableTwoFactor, { isLoading }] = useDisableTwoFactorMutation();
  const handleFeatureDisabled = useFeatureDisabledHandler();
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  const schema = useMemo(() => createAnswerSchema(tAnswer), [tAnswer]);
  const form = useFormWithValidation({
    schema,
    defaultValues: { code: '', recoveryCode: '' },
    mode: 'onSubmit',
  });

  const {
    handleSubmit,
    formState: { errors },
    setError,
    resetField,
    reset,
  } = form;

  const onToggle = useCallback(() => {
    resetField('code');
    resetField('recoveryCode');
    setUseRecoveryCode((current) => !current);
  }, [resetField]);

  const submit = useCallback(
    async (data: DisableFormData) => {
      try {
        await disableTwoFactor({ ...toAnswer(data), password: data.password }).unwrap();
        toast.success(t('success'));
        reset();
        onOpenChange(false);
      } catch (err) {
        if (handleFeatureDisabled(err)) {
          return;
        }
        setError('root', { type: 'manual', message: tCodes(translatableErrorCode(err)) });
      }
    },
    [disableTwoFactor, handleFeatureDisabled, onOpenChange, reset, setError, t, tCodes],
  );
  const onSubmit = useSingleFlight(submit);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="two-factor-disable-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <FormProvider {...form}>
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4"
            data-testid="two-factor-disable-form"
            noValidate
          >
            <FormRootError
              id="two-factor-disable-error"
              error={errors.root?.message}
              testId="two-factor-disable-error"
            />

            {hasPassword && <HiddenUsernameField />}
            {hasPassword && (
              <FormPassword<DisableFormData>
                name="password"
                label={t('password')}
                placeholder={tCommon('passwordPlaceholder')}
                autoComplete="current-password"
                disabled={isLoading}
                data-testid="two-factor-disable-password"
              />
            )}

            <TwoFactorAnswerFields
              useRecoveryCode={useRecoveryCode}
              onToggle={onToggle}
              isBusy={isLoading}
            />

            <SubmitButton
              isLoading={isLoading}
              icon={ShieldOff}
              variant="destructive"
              className="h-10 mt-0 w-full py-2"
              testId="two-factor-disable-submit"
            >
              {t('submit')}
            </SubmitButton>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
