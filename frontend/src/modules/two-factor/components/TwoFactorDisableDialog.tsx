'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FormProvider } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { ShieldOff } from 'lucide-react';
import { useFormWithValidation } from '@/hooks/useFormWithValidation';
import { FormPassword, FormRootError, SubmitButton } from '@/components/forms';
import { SERVER_FIELD_ERROR_TYPE } from '@/hooks/useServerFieldErrors';
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
import {
  createDisableSchema,
  refusedField,
  toDisableRequest,
  type DisableField,
  type DisableFormData,
} from '../utils/disableSchema';
import { TwoFactorAnswerFields } from './TwoFactorAnswerFields';
import { useSingleFlight } from '@/hooks/useSingleFlight';
import { useRefusalToast } from '@/hooks/useRefusalToast';
import { useRemovalFocus, type RemovalLanding } from '@/hooks/useRemovalFocus';

interface TwoFactorDisableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** True when the account has a password, which the backend also asks for. */
  hasPassword: boolean;
  /** The heading that takes focus once it is off and the button that opened this is gone. */
  landing?: RemovalLanding;
}

const EMPTY_FORM: DisableFormData = { password: '', code: '', recoveryCode: '' };

/** Turns the second factor off. Needs a code or a recovery code either way. */
export function TwoFactorDisableDialog({
  open,
  onOpenChange,
  hasPassword,
  landing,
}: TwoFactorDisableDialogProps) {
  const t = useTranslations('settings.twoFactor.disable');
  const tPassword = useTranslations('settings.password');
  const tCommon = useTranslations('common');
  const tCodes = useTranslations('errors.codes');
  const tAnswer = useTranslations('auth.twoFactor');
  const [disableTwoFactor, { isLoading }] = useDisableTwoFactorMutation();
  const handleFeatureDisabled = useFeatureDisabledHandler();
  const refusalToast = useRefusalToast(open);
  const { noteRemoved, focusLanding } = useRemovalFocus(landing);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  // The dialog focuses its first field, the password, unless the answer claims it.
  const [answerTakesFocus, setAnswerTakesFocus] = useState(false);
  const [refused, setRefused] = useState<{ field: DisableField } | null>(null);

  const schema = useMemo(
    () =>
      createDisableSchema(tAnswer, hasPassword ? tPassword('currentPasswordRequired') : undefined),
    [hasPassword, tAnswer, tPassword],
  );
  const form = useFormWithValidation({ schema, defaultValues: EMPTY_FORM, mode: 'onSubmit' });

  const {
    handleSubmit,
    formState: { errors },
    setError,
    setFocus,
    resetField,
    reset,
  } = form;

  // The focus moves to the refused field once the refusal has been drawn.
  useEffect(() => {
    if (refused === null) return;
    setFocus(refused.field);
  }, [refused, setFocus]);

  const onToggle = useCallback(() => {
    resetField('code');
    resetField('recoveryCode');
    setAnswerTakesFocus(true);
    setUseRecoveryCode((current) => !current);
  }, [resetField]);

  // What was typed, the password above all, does not outlive the dialog.
  const close = useCallback(() => {
    reset();
    setUseRecoveryCode(false);
    setAnswerTakesFocus(false);
    setRefused(null);
    onOpenChange(false);
  }, [onOpenChange, reset]);

  const onDialogOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        onOpenChange(true);
        return;
      }
      close();
    },
    [close, onOpenChange],
  );

  const submit = useCallback(
    async (data: DisableFormData) => {
      const request = toDisableRequest(data);
      // A wrong password leaves a toast, and the next answer may be about the code.
      refusalToast.clearStale();
      try {
        await disableTwoFactor(request).unwrap();
        toast.success(t('success'));
        noteRemoved();
        close();
      } catch (err) {
        refusalToast.noteRefusal();
        if (handleFeatureDisabled(err)) {
          return;
        }
        const errorCode = translatableErrorCode(err);
        const field = refusedField(errorCode, request);
        if (field === null) {
          setError('root', { type: 'manual', message: tCodes(errorCode) });
          return;
        }
        setError(field, { type: SERVER_FIELD_ERROR_TYPE, message: tCodes(errorCode) });
        setRefused({ field });
      }
    },
    [
      close,
      disableTwoFactor,
      handleFeatureDisabled,
      refusalToast,
      noteRemoved,
      setError,
      t,
      tCodes,
    ],
  );
  const onSubmit = useSingleFlight(submit);

  return (
    <Dialog open={open} onOpenChange={onDialogOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="two-factor-disable-dialog"
        onCloseAutoFocus={focusLanding}
      >
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
                busy={isLoading}
                data-testid="two-factor-disable-password"
              />
            )}

            <TwoFactorAnswerFields
              useRecoveryCode={useRecoveryCode}
              onToggle={onToggle}
              isBusy={isLoading}
              autoFocus={!hasPassword || answerTakesFocus}
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
