'use client';

import { useCallback, useMemo, useState } from 'react';
import { FormProvider } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { RefreshCw } from 'lucide-react';
import { useFormWithValidation } from '@/hooks/useFormWithValidation';
import { FormRootError, SubmitButton } from '@/components/forms';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useFeatureDisabledHandler } from '@/modules/auth/hooks/useFeatureDisabled';
import { translatableErrorCode } from '@/modules/auth/utils/errorCodeMessage';
import { useRegenerateRecoveryCodesMutation } from '../api';
import { TOTP_CODE_LENGTH } from '../constants';
import { CodeField } from './CodeField';
import { RecoveryCodeList } from './RecoveryCodeList';
import { useSingleFlight } from '@/hooks/useSingleFlight';

interface RegenerateCodesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const createSchema = (t: (key: string) => string) =>
  z.object({
    code: z.string().regex(new RegExp(`^\\d{${TOTP_CODE_LENGTH}}$`), t('codeLength')),
  });

type RegenerateFormData = z.infer<ReturnType<typeof createSchema>>;

/**
 * Issues a fresh batch of recovery codes and drops the old one, used or not.
 * The new codes show once, here.
 */
export function RegenerateCodesDialog({ open, onOpenChange }: RegenerateCodesDialogProps) {
  const t = useTranslations('settings.twoFactor.regenerate');
  const tAnswer = useTranslations('auth.twoFactor');
  const tCodes = useTranslations('errors.codes');
  const [regenerate, { isLoading }] = useRegenerateRecoveryCodesMutation();
  const handleFeatureDisabled = useFeatureDisabledHandler();
  const [codes, setCodes] = useState<string[] | null>(null);

  const schema = useMemo(() => createSchema(tAnswer), [tAnswer]);
  const form = useFormWithValidation({ schema, defaultValues: { code: '' }, mode: 'onSubmit' });

  const {
    handleSubmit,
    formState: { errors },
    setError,
    reset,
  } = form;

  const submit = useCallback(
    async (data: RegenerateFormData) => {
      try {
        const result = await regenerate({ code: data.code }).unwrap();
        setCodes(result.recoveryCodes);
      } catch (err) {
        if (handleFeatureDisabled(err)) {
          return;
        }
        setError('root', { type: 'manual', message: tCodes(translatableErrorCode(err)) });
      }
    },
    [handleFeatureDisabled, regenerate, setError, tCodes],
  );
  const onSubmit = useSingleFlight(submit);

  const onDone = useCallback(() => {
    setCodes(null);
    reset();
    onOpenChange(false);
  }, [onOpenChange, reset]);

  // Once the new codes are on screen they exist nowhere else, so only the
  // close button dismisses the dialog.
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
    <Dialog open={open} onOpenChange={onDialogOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="two-factor-regenerate-dialog">
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
                error={errors.root?.message}
                testId="two-factor-regenerate-error"
              />

              <CodeField<RegenerateFormData>
                name="code"
                label={tAnswer('code')}
                disabled={isLoading}
                autoFocus
                testId="two-factor-regenerate-code"
              />

              <SubmitButton
                isLoading={isLoading}
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
