'use client';

import { Description, Heading } from '@/components/design-system';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { FormProvider } from 'react-hook-form';
import { useFormWithValidation } from '@/hooks/useFormWithValidation';
import { FormInput, FormRootError, SubmitButton } from '@/components/forms';
import { useForgotPasswordMutation } from '@/modules/auth/store/authApi';
import { NETWORK_ERROR_CODE, zodEmail, parseApiError } from '@app/core';
import { Mail } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { toast } from '@/lib/toast';
import { Link, useRouter } from '@/i18n/navigation';
import { preventNavigationBlur } from '@/modules/auth/utils/preventNavigationBlur';
import { useSingleFlight } from '@/hooks/useSingleFlight';

/**
 * Forgot password form validation schema
 */
const createForgotPasswordSchema = (t: (key: string) => string) =>
  z.object({
    email: zodEmail({
      required: true,
      messages: {
        required: t('errors.emailRequired'),
        invalid: t('errors.emailInvalid'),
      },
    }),
  });

type ForgotPasswordFormData = z.infer<ReturnType<typeof createForgotPasswordSchema>>;

/**
 * ForgotPasswordForm component for requesting password reset
 * Sends reset link to user's email address
 *
 * @example
 * <ForgotPasswordForm />
 */
export function ForgotPasswordForm() {
  const t = useTranslations('auth.forgotPassword');
  const tCommon = useTranslations('common');
  const tToast = useTranslations('toast');
  const router = useRouter();
  const [forgotPassword, { isLoading }] = useForgotPasswordMutation();

  // Memoize schema creation when translation function changes
  const forgotPasswordSchema = useMemo(() => createForgotPasswordSchema(t), [t]);

  // Initialize form with validation
  const form = useFormWithValidation({
    schema: forgotPasswordSchema,
    mode: 'onBlur',
    defaultValues: {
      email: '',
    },
  });

  const {
    handleSubmit,
    formState: { errors },
    setError,
  } = form;

  // Memoize submit handler to prevent recreating on every render

  const submit = useCallback(
    async (data: ForgotPasswordFormData) => {
      try {
        await forgotPassword({
          email: data.email,
        }).unwrap();

        // Show success toast
        toast.success(tToast('success.resetLinkSent'));

        // Redirect to reset password page with email
        router.push(`/auth/reset-password?email=${encodeURIComponent(data.email)}`);
      } catch (err: unknown) {
        const parsed = parseApiError(err);
        let errorMessage = t('errors.serverError');

        if (parsed.code === NETWORK_ERROR_CODE) {
          errorMessage = t('errors.networkError');
        } else if (parsed.message) {
          errorMessage = parsed.message;
        }

        setError('root', {
          type: 'manual',
          message: errorMessage,
        });
      }
    },
    [forgotPassword, router, setError, t, tToast],
  );
  const onSubmit = useSingleFlight(submit);

  return (
    <section className="mt-12 flex flex-col items-center" aria-labelledby="forgot-password-heading">
      {/* Title */}
      <Heading
        level={1}
        variant="display"
        id="forgot-password-heading"

        data-testid="forgot-password-title"
      >
        {t('title')}
      </Heading>

      {/* Subtitle */}
      <Description variant="lead" className="mt-4 text-center max-w-md">
        {t('subtitle')}
      </Description>

      <div className="w-full flex-1 mt-8">
        {/* Forgot Password Form */}
        <FormProvider {...form}>
          <form
            className="mx-auto max-w-xs"
            onSubmit={handleSubmit(onSubmit)}
            data-testid="forgot-password-form"
            noValidate
            aria-labelledby="forgot-password-heading"
            aria-describedby={errors.root?.message ? 'forgot-password-error' : undefined}
          >
            <FormRootError
              id="forgot-password-error"
              error={errors.root?.message}
              testId="forgot-password-error"
            />

            {/* Email Input */}
            <FormInput
              name="email"
              data-testid="forgot-password-email-input"
              type="email"
              label={t('email')}
              placeholder={tCommon('emailPlaceholder')}
              autoComplete="email"
              disabled={isLoading}
              autoFocus
            />

            {/* Submit Button */}
            <SubmitButton isLoading={isLoading} icon={Mail} testId="forgot-password-submit">
              {t('submit')}
            </SubmitButton>

            {/* Back to Login Link */}
            <div className="mt-6 text-center">
              <Link
                href="/auth/login"
                className="text-sm font-semibold text-primary hover:underline transition-colors"
                data-testid="back-to-login-link"
                onMouseDown={preventNavigationBlur}
              >
                {t('backToLogin')}
              </Link>
            </div>
          </form>
        </FormProvider>
      </div>
    </section>
  );
}
