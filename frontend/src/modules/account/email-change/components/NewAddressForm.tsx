'use client';

import { useMemo, useRef } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { z } from 'zod/v3';
import { zodEmail } from '@app/core';
import { Button } from '@/components/ui/button';
import { FormInput, FormRootError, SubmitButton } from '@/components/forms';
import { useFormRefusal } from '@/hooks/useFormRefusal';
import { useFormFieldTarget } from '@/hooks/useServerFieldErrors';
import { useSingleFlight } from '@/hooks/useSingleFlight';
import { showsOwnRefusal } from '@/lib/refusal';
import { reportUnlessHandled } from '@/lib/requestFailure';
import { toast } from '@/lib/toast';
import { useRequestOwnEmailChangeMutation } from '../api/ownEmailApi';

type Translate = (key: string) => string;

function addressSchema(t: Translate, current: string) {
  return z.object({
    email: zodEmail({
      required: true,
      messages: { required: t('addressRequired'), invalid: t('addressInvalid') },
    }).refine((email) => email.trim().toLowerCase() !== current, t('sameAddress')),
  });
}

type AddressData = z.infer<ReturnType<typeof addressSchema>>;

interface NewAddressFormProps {
  /** The address the account has now, which the form refuses. */
  current: string;
  onSent: () => void;
  onCancel: () => void;
}

/** Asks for a code at a new address. The server answers a taken one like a free one. */
export function NewAddressForm({ current, onSent, onCancel }: NewAddressFormProps) {
  const t = useTranslations('emailChange');
  const schema = useMemo(() => addressSchema(t, current), [t, current]);
  const form = useForm<AddressData>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });
  const formRef = useRef<HTMLFormElement>(null);
  const [requestChange, { isLoading }] = useRequestOwnEmailChangeMutation();
  const refusal = useFormRefusal(useFormFieldTarget(form.setError, formRef), isLoading);

  const submit = async ({ email }: AddressData) => {
    refusal.clear();
    try {
      const state = await showsOwnRefusal(requestChange(email)).unwrap();
      toast.success(t('sent', { address: state.pendingEmail ?? email }));
      onSent();
    } catch (error) {
      refusal.show(error);
      reportUnlessHandled(error);
    }
  };
  const onSubmit = useSingleFlight(submit);

  return (
    <FormProvider {...form}>
      <form
        ref={formRef}
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4"
        noValidate
        data-testid="email-change-address-form"
      >
        <FormRootError error={refusal.alert} testId="email-change-address-error" />
        <FormInput<AddressData>
          name="email"
          type="email"
          label={t('newAddress')}
          placeholder={t('newAddressPlaceholder')}
          description={t('newAddressHint')}
          autoComplete="email"
          required
          autoFocus
          busy={isLoading}
          data-testid="email-change-address-input"
        />
        <div className="flex flex-wrap gap-2">
          <SubmitButton isLoading={isLoading} className="mt-0" testId="email-change-send">
            {t('send')}
          </SubmitButton>
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            busy={isLoading}
            data-testid="email-change-address-cancel"
          >
            {t('cancel')}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
