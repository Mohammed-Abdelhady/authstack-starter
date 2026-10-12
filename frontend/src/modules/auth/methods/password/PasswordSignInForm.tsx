'use client';

import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { FormProvider } from 'react-hook-form';
import { FORM_STYLES } from '@/lib/config/form-styles';
import { LogIn } from 'lucide-react';
import { useFormWithValidation } from '@/hooks/useFormWithValidation';
import { FormInput, FormPassword, FormRootError, SubmitButton } from '@/components/forms';
import { zodEmail } from '@app/core';
import { Link } from '@/i18n/navigation';
import { useCompleteSignIn } from '@/modules/auth/hooks/useCompleteSignIn';
import { useValidateFilledOnBlur } from '@/modules/auth/hooks/useValidateFilledOnBlur';
import { useLoginMutation } from '@/modules/auth/store/authApi';
import { translateAuthError } from '@/modules/auth/utils/authHelpers';
import { translatableErrorCode } from '@/modules/auth/utils/errorCodeMessage';
import { preventNavigationBlur } from '@/modules/auth/utils/preventNavigationBlur';
import type { AuthMethodFormProps } from '../types';
import { useSingleFlight } from '@/hooks/useSingleFlight';
import { useRefusalToast } from '@/hooks/useRefusalToast';

/**
 * Sign-in schema. The minimum length is only there to catch an empty box; the
 * strength rules belong to registration, not to an account that already exists.
 */
const createPasswordSignInSchema = (t: (key: string) => string) =>
  z.object({
    email: zodEmail({
      required: true,
      messages: { required: t('errors.emailRequired'), invalid: t('errors.emailInvalid') },
    }),
    password: z
      .string({ required_error: t('errors.passwordRequired') })
      .min(1, t('errors.passwordRequired'))
      .min(6, t('errors.passwordMinLength')),
  });

type PasswordSignInData = z.infer<ReturnType<typeof createPasswordSignInSchema>>;

/** Email and password sign-in. Hands a challenged account to /auth/2fa. */
export function PasswordSignInForm({ redirect }: AuthMethodFormProps) {
  const t = useTranslations('auth.login');
  const tCommon = useTranslations('common');
  const tCodes = useTranslations('errors.codes');
  const [login, { isLoading }] = useLoginMutation();
  const refusalToast = useRefusalToast();
  const completeSignIn = useCompleteSignIn();

  const schema = useMemo(() => createPasswordSignInSchema(t), [t]);
  const form = useFormWithValidation({
    schema,
    defaultValues: { email: '', password: '' },
    mode: 'onSubmit',
  });
  const onEmailBlur = useValidateFilledOnBlur(form, 'email');
  const onPasswordBlur = useValidateFilledOnBlur(form, 'password');

  const {
    handleSubmit,
    formState: { errors },
    setError,
  } = form;

  const submit = useCallback(
    async (data: PasswordSignInData) => {
      refusalToast.clearStale();
      try {
        const response = await login({ email: data.email, password: data.password }).unwrap();
        await completeSignIn(response, redirect);
      } catch (err) {
        refusalToast.noteRefusal();
        const code = translatableErrorCode(err, '');
        setError('root', {
          type: 'manual',
          message: code ? tCodes(code) : translateAuthError(err, t),
        });
      }
    },
    [completeSignIn, login, redirect, refusalToast, setError, t, tCodes],
  );
  const onSubmit = useSingleFlight(submit);

  return (
    <FormProvider {...form}>
      <form
        className="mx-auto max-w-xs"
        onSubmit={handleSubmit(onSubmit)}
        data-testid="login-form"
        noValidate
        aria-labelledby="login-heading"
        aria-describedby={errors.root?.message ? 'login-error' : undefined}
      >
        <FormRootError
          id="login-error"
          error={errors.root?.message}
          // Clear of the control above it, which is not part of this form.
          className="mt-4"
          testId="login-error"
        />

        <FormInput
          containerClassName={FORM_STYLES.authField}
          name="email"
          type="email"
          label={t('email')}
          placeholder={tCommon('emailPlaceholder')}
          autoComplete="username"
          required
          busy={isLoading}
          autoFocus
          onBlur={onEmailBlur}
          data-testid="login-email-input"
        />

        <FormPassword
          name="password"
          label={t('password')}
          placeholder={tCommon('passwordPlaceholder')}
          autoComplete="current-password"
          required
          busy={isLoading}
          showToggle={false}
          onBlur={onPasswordBlur}
          className={FORM_STYLES.authField}
          data-testid="login-password-input"
        />

        <SubmitButton isLoading={isLoading} icon={LogIn} testId="login-submit">
          {t('submit')}
        </SubmitButton>

        <div className="mt-2 flex justify-end">
          <Link
            href="/auth/forgot-password"
            className="no-underline hover:underline text-primary text-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-card rounded-sm"
            data-testid="forgot-password-link"
            aria-label={t('forgotPassword')}
            onMouseDown={preventNavigationBlur}
          >
            {t('forgotPassword')}
          </Link>
        </div>
      </form>
    </FormProvider>
  );
}
