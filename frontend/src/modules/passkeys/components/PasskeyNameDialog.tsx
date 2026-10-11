'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { FormProvider } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { z } from 'zod';
import { useFormWithValidation } from '@/hooks/useFormWithValidation';
import { FormInput, FormRootError, SubmitButton } from '@/components/forms';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useFeatureDisabledHandler } from '@/modules/auth/hooks/useFeatureDisabled';
import { translatableErrorCode } from '@/modules/auth/utils/errorCodeMessage';
import { useRenamePasskeyMutation } from '../api';
import { PASSKEY_NAME_MAX_LENGTH } from '../constants';
import { PASSKEY_NAME_MODE, type PasskeyNameTarget } from '../types';
import { useSingleFlight } from '@/hooks/useSingleFlight';

interface PasskeyNameDialogProps {
  open: boolean;
  /** The passkey to name, and why it is being named. */
  target: PasskeyNameTarget | null;
  onClose: () => void;
}

const createNameSchema = (t: (key: string, values?: Record<string, number>) => string) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t('errors.nameRequired'))
      .max(PASSKEY_NAME_MAX_LENGTH, t('errors.nameTooLong', { max: PASSKEY_NAME_MAX_LENGTH })),
  });

type NameFormData = z.infer<ReturnType<typeof createNameSchema>>;

/**
 * Names a passkey, either straight after it was added or later.
 *
 * A passkey added here already carries the device it came from, so closing
 * this without saving leaves a usable name rather than nothing.
 */
export function PasskeyNameDialog({ open, target, onClose }: PasskeyNameDialogProps) {
  const t = useTranslations('settings.passkeys');
  const tCodes = useTranslations('errors.codes');
  const [renamePasskey, { isLoading }] = useRenamePasskeyMutation();
  const handleFeatureDisabled = useFeatureDisabledHandler();

  const schema = useMemo(() => createNameSchema(t), [t]);
  const form = useFormWithValidation({
    schema,
    defaultValues: { name: '' },
    mode: 'onSubmit',
  });

  const {
    handleSubmit,
    formState: { errors },
    setError,
    reset,
  } = form;

  // The dialog stays mounted between passkeys, so the field follows the target.
  useEffect(() => {
    if (target) {
      reset({ name: target.passkey.name });
    }
  }, [target, reset]);

  const submit = useCallback(
    async (data: NameFormData) => {
      if (!target) {
        return;
      }
      try {
        await renamePasskey({ id: target.passkey.id, name: data.name }).unwrap();
        onClose();
      } catch (err) {
        // The gate takes the card off the page once the refetch lands.
        if (handleFeatureDisabled(err)) {
          onClose();
          return;
        }
        setError('root', { type: 'manual', message: tCodes(translatableErrorCode(err)) });
      }
    },
    [handleFeatureDisabled, onClose, renamePasskey, setError, tCodes, target],
  );
  const onSubmit = useSingleFlight(submit);

  const isCreate = target?.mode === PASSKEY_NAME_MODE.CREATE;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="passkey-name-dialog">
        <DialogHeader>
          <DialogTitle>{isCreate ? t('name.title') : t('rename.title')}</DialogTitle>
          <DialogDescription>
            {isCreate ? t('name.description') : t('rename.description')}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...form}>
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4"
            data-testid="passkey-name-form"
            noValidate
          >
            <FormRootError
              id="passkey-name-error"
              error={errors.root?.message}
              testId="passkey-name-error"
            />

            <FormInput
              name="name"
              label={t('name.field')}
              maxLength={PASSKEY_NAME_MAX_LENGTH}
              disabled={isLoading}
              autoFocus
              data-testid="passkey-name-input"
            />

            <SubmitButton
              isLoading={isLoading}
              icon={Check}
              className="h-10 mt-0 w-full py-2"
              testId="passkey-name-submit"
            >
              {t('name.submit')}
            </SubmitButton>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
