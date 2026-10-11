'use client';

import { useCallback, useMemo, useRef } from 'react';
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
import { useLoginMutation } from '@/modules/auth/store/authApi';
import { translateAuthError } from '@/modules/auth/utils/authHelpers';
import { translatableErrorCode } from '@/modules/auth/utils/errorCodeMessage';
import { preventNavigationBlur } from '@/modules/auth/utils/preventNavigationBlur';
import type { AuthMethodFormProps } from '../types';

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
  const completeSignIn = useCompleteSignIn();

  const schema = useMemo(() => createPasswordSignInSchema(t), [t]);
  const form = useFormWithValidation({
    schema,
    defaultValues: { email: '', password: '' },
    mode: 'onBlur',
  });

  const {
    handleSubmit,
    formState: { errors },
    setError,
  } = form;

  const inFlight = useRef(false);

  const onSubmit = useCallback(
    async (data: PasswordSignInData) => {
      // The button is only disabled after a render, which a second submission
      // in the same tick does not wait for.
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const response = await login({ email: data.email, password: data.password }).unwrap();
        await completeSignIn(response, redirect);
      } catch (err) {
        const code = translatableErrorCode(err, '');
        setError('root', {
          type: 'manual',
          message: code ? tCodes(code) : translateAuthError(err, t),
        });
      } finally {
        inFlight.current = false;
      }
    },
    [completeSignIn, login, redirect, setError, t, tCodes],
  );

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
        <FormRootError id="login-error" error={errors.root?.message} testId="login-error" />

        <FormInput
          containerClassName={FORM_STYLES.authField}
          name="email"
          type="email"
          label={t('email')}
          placeholder={tCommon('emailPlaceholder')}
          autoComplete="email"
          disabled={isLoading}
          autoFocus
          data-testid="login-email-input"
        />

        <FormPassword
          name="password"
          label={t('password')}
          placeholder={tCommon('passwordPlaceholder')}
          autoComplete="current-password"
          disabled={isLoading}
          showToggle={false}
          className={FORM_STYLES.authField}
          data-testid="login-password-input"
        />

        <SubmitButton isLoading={isLoading} icon={LogIn} testId="login-submit">
          {t('submit')}
        </SubmitButton>

        <div className="mt-2 flex justify-end">
          <Link
            href="/auth/forgot-password"
            className="no-underline hover:underline text-primary text-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded-sm"
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
