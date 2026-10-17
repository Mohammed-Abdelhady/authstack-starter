'use client';

import { Description, Heading } from '@/components/design-system';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FormProvider } from 'react-hook-form';
import type { z } from 'zod/v3';
import { ShieldCheck } from 'lucide-react';
import { FormInput, FormRootError, SubmitButton } from '@/components/forms';
import { useFormWithValidation } from '@/hooks/useFormWithValidation';
import { useFormFieldTarget, useServerFieldErrors } from '@/hooks/useServerFieldErrors';
import { LOGIN_PATH, VERIFICATION_CODE_LENGTH } from '../constants/authMethods';
import { useConfirmEmailChangeMutation } from '../store/authApi';
import { createEmailCodeSchema } from '../utils/emailCodeSchema';
import { filterDigits } from '../utils/digitFilter';
import { translatableErrorCode } from '../utils/errorCodeMessage';
import { CODE_ENTRY_FONT_SIZE, FORM_STYLES } from '@/lib/config/form-styles';
import { cn } from '@/lib/utils';
import { AuthCompletionNotice } from './AuthCompletionNotice';
import { useSingleFlight } from '@/hooks/useSingleFlight';

type EmailCodeData = z.infer<ReturnType<typeof createEmailCodeSchema>>;

// Client boundary for form state and the confirmation write. This operation issues no session.
export function ConfirmEmailChangeForm() {
  const t = useTranslations('auth.confirmEmailChange');
  const tFields = useTranslations('auth.activate');
  const tCodes = useTranslations('errors.codes');
  const schema = useMemo(() => createEmailCodeSchema(tFields), [tFields]);
  const form = useFormWithValidation({
    schema,
    defaultValues: { email: '', code: '' },
    mode: 'onBlur',
  });
  const [confirm, { isLoading }] = useConfirmEmailChangeMutation();
  const [confirmed, setConfirmed] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const applyServerFieldErrors = useServerFieldErrors(
    useFormFieldTarget(form.setError, formRef),
    isLoading,
  );
  const submit = useCallback(
    async (data: EmailCodeData) => {
      try {
        await confirm(data).unwrap();
        setConfirmed(true);
      } catch (error) {
        applyServerFieldErrors(error);
        form.setError('root', { type: 'manual', message: tCodes(translatableErrorCode(error)) });
      }
    },
    [applyServerFieldErrors, confirm, form, tCodes],
  );
  const onSubmit = useSingleFlight(submit);
  const onCodeChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    event.target.value = filterDigits(event.target.value, VERIFICATION_CODE_LENGTH);
  }, []);

  if (confirmed) {
    return (
      <AuthCompletionNotice
        title={t('successTitle')}
        message={t('success')}
        href={LOGIN_PATH}
        actionLabel={t('signIn')}
        testId="confirm-email-success"
        actionTestId="confirm-email-signin"
      />
    );
  }

  return (
    <section className="mt-12 flex flex-col items-center" aria-labelledby="confirm-email-heading">
      <Heading level={1} variant="display" id="confirm-email-heading">
        {t('title')}
      </Heading>
      <Description variant="lead" className="mt-4 text-center max-w-md">
        {t('description')}
      </Description>
      <div className="w-full flex-1 mt-8">
        <FormProvider {...form}>
          <form
            ref={formRef}
            className="mx-auto max-w-xs"
            onSubmit={form.handleSubmit(onSubmit)}
            data-testid="confirm-email-form"
            noValidate
            aria-labelledby="confirm-email-heading"
            aria-describedby={
              form.formState.errors.root?.message ? 'confirm-email-error' : undefined
            }
          >
            <FormRootError
              id="confirm-email-error"
              error={form.formState.errors.root?.message}
              testId="confirm-email-error"
            />
            <FormInput
              containerClassName={FORM_STYLES.authField}
              name="email"
              type="email"
              label={tFields('email')}
              placeholder={tFields('emailPlaceholder')}
              autoComplete="email"
              required
              autoFocus
              busy={isLoading}
              data-testid="confirm-email-input"
            />
            <FormInput
              containerClassName={FORM_STYLES.authField}
              name="code"
              type="text"
              label={tFields('code')}
              placeholder={tFields('codePlaceholder')}
              autoComplete="one-time-code"
              required
              inputMode="numeric"
              onChange={onCodeChange}
              busy={isLoading}
              className={cn('text-center tracking-widest', CODE_ENTRY_FONT_SIZE)}
              data-testid="confirm-email-code-input"
            />
            <SubmitButton isLoading={isLoading} icon={ShieldCheck} testId="confirm-email-submit">
              {t('submit')}
            </SubmitButton>
          </form>
        </FormProvider>
      </div>
    </section>
  );
}
