'use client';

import { useCallback, useMemo } from 'react';
import { FormProvider } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { ShieldCheck } from 'lucide-react';
import { useFormWithValidation } from '@/hooks/useFormWithValidation';
import { SubmitButton } from '@/components/forms';
import { Button } from '@/components/ui/button';
import { CodeField } from '../CodeField';
import { TOTP_CODE_LENGTH } from '../../constants';

interface ConfirmStepProps {
  isBusy: boolean;
  onConfirm: (code: string) => void;
  onBack: () => void;
}

const createConfirmSchema = (t: (key: string) => string) =>
  z.object({
    code: z.string().regex(new RegExp(`^\\d{${TOTP_CODE_LENGTH}}$`), t('codeLength')),
  });

type ConfirmFormData = z.infer<ReturnType<typeof createConfirmSchema>>;

/** Step three. One correct code proves the app and the server agree. */
export function ConfirmStep({ isBusy, onConfirm, onBack }: ConfirmStepProps) {
  const t = useTranslations('settings.twoFactor.setup.confirm');
  const schema = useMemo(() => createConfirmSchema(t), [t]);
  const form = useFormWithValidation({ schema, defaultValues: { code: '' }, mode: 'onSubmit' });

  const onSubmit = useCallback((data: ConfirmFormData) => onConfirm(data.code), [onConfirm]);

  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4"
        data-testid="two-factor-confirm-form"
        noValidate
      >
        <p className="text-sm text-muted-foreground">{t('body')}</p>

        <CodeField<ConfirmFormData>
          name="code"
          label={t('code')}
          busy={isBusy}
          autoFocus
          testId="two-factor-confirm-code"
        />

        <SubmitButton
          isLoading={isBusy}
          icon={ShieldCheck}
          className="h-10 mt-0 w-full py-2"
          testId="two-factor-confirm-submit"
        >
          {t('submit')}
        </SubmitButton>

        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={onBack}
          data-testid="two-factor-confirm-back"
        >
          {t('back')}
        </Button>
      </form>
    </FormProvider>
  );
}
