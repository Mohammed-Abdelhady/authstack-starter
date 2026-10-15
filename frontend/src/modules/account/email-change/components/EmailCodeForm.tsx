'use client';

import { useCallback, useMemo, useRef } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FormInput, FormRootError, SubmitButton } from '@/components/forms';
import { useFormRefusal } from '@/hooks/useFormRefusal';
import { useFormFieldTarget } from '@/hooks/useServerFieldErrors';
import { useSingleFlight } from '@/hooks/useSingleFlight';
import { CODE_ENTRY_FONT_SIZE } from '@/lib/config/form-styles';
import { showsOwnRefusal } from '@/lib/refusal';
import { reportUnlessHandled } from '@/lib/requestFailure';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { VERIFICATION_CODE_LENGTH } from '@/modules/auth/constants/authMethods';
import { filterDigits } from '@/modules/auth/utils/digitFilter';
import {
  useCancelOwnEmailChangeMutation,
  useConfirmOwnEmailChangeMutation,
} from '../api/ownEmailApi';

const CODE_SHAPE = new RegExp(`^\\d{${VERIFICATION_CODE_LENGTH}}$`);

function codeSchema(invalid: string) {
  return z.object({ code: z.string().regex(CODE_SHAPE, invalid) });
}

type CodeData = z.infer<ReturnType<typeof codeSchema>>;

interface EmailCodeFormProps {
  /** The address the code was mailed to. */
  pending: string;
  onOtherAddress: () => void;
}

/**
 * Takes the code mailed to the pending address. Confirming keeps this browser
 * signed in and signs out every other device; keeping the current address
 * frees the pending one.
 */
export function EmailCodeForm({ pending, onOtherAddress }: EmailCodeFormProps) {
  const t = useTranslations('emailChange');
  const schema = useMemo(() => codeSchema(t('codeInvalid')), [t]);
  const form = useForm<CodeData>({ resolver: zodResolver(schema), defaultValues: { code: '' } });
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmChange, { isLoading: confirming }] = useConfirmOwnEmailChangeMutation();
  const [cancelChange, { isLoading: cancelling }] = useCancelOwnEmailChangeMutation();
  const busy = confirming || cancelling;
  const refusal = useFormRefusal(useFormFieldTarget(form.setError, formRef), busy);

  const submit = async ({ code }: CodeData) => {
    refusal.clear();
    try {
      await showsOwnRefusal(confirmChange(code)).unwrap();
      toast.success(t('changed'));
    } catch (error) {
      refusal.show(error);
      reportUnlessHandled(error);
    }
  };
  const onSubmit = useSingleFlight(submit);

  const keepCurrent = useSingleFlight(async () => {
    refusal.clear();
    try {
      await showsOwnRefusal(cancelChange()).unwrap();
      toast.info(t('cancelled'));
    } catch (error) {
      refusal.show(error);
      reportUnlessHandled(error);
    }
  });

  const onCodeChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    event.target.value = filterDigits(event.target.value, VERIFICATION_CODE_LENGTH);
  }, []);

  return (
    <FormProvider {...form}>
      <form
        ref={formRef}
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4"
        noValidate
        data-testid="email-change-code-form"
      >
        <FormRootError error={refusal.alert} testId="email-change-code-error" />
        <FormInput<CodeData>
          name="code"
          type="text"
          label={t('code')}
          placeholder={t('codePlaceholder')}
          description={t('codeHint', { address: pending })}
          autoComplete="one-time-code"
          inputMode="numeric"
          required
          onChange={onCodeChange}
          busy={busy}
          className={cn('text-center tracking-widest', CODE_ENTRY_FONT_SIZE)}
          data-testid="email-change-code-input"
        />
        <div className="flex flex-wrap gap-2">
          <SubmitButton isLoading={confirming} className="mt-0" testId="email-change-confirm">
            {t('confirm')}
          </SubmitButton>
          <Button
            type="button"
            variant="outline"
            onClick={onOtherAddress}
            disabled={busy}
            data-testid="email-change-other-address"
          >
            {t('otherAddress')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void keepCurrent()}
            busy={cancelling}
            disabled={confirming}
            data-testid="email-change-keep-current"
          >
            {t('keepCurrent')}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
