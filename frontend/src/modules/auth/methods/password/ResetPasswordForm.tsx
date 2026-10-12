'use client';

import { Description, Heading } from '@/components/design-system';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { FormProvider } from 'react-hook-form';
import { useFormWithValidation } from '@/hooks/useFormWithValidation';
import {
  FormInput,
  FormPassword,
  FormRootError,
  PasswordRules,
  SubmitButton,
} from '@/components/forms';
import { useResetPasswordMutation } from '@/modules/auth/store/authApi';
import { ErrorCode, parseApiError } from '@app/core';
import { KeyRound } from 'lucide-react';
import { useCallback, useMemo, useEffect, useState } from 'react';
import { toast } from '@/lib/toast';
import { Link, useRouter } from '@/i18n/navigation';
import { preventNavigationBlur } from '@/modules/auth/utils/preventNavigationBlur';
import { useRefusalText } from '@/hooks/useRefusalText';
import { showsOwnRefusal } from '@/lib/refusal';
import { createPasswordSchema } from '@/modules/auth/utils/passwordSchema';
import { filterDigits } from '@/modules/auth/utils/digitFilter';
import { CODE_ENTRY_FONT_SIZE, FORM_STYLES } from '@/lib/config/form-styles';
import { cn } from '@/lib/utils';
import { useSingleFlight } from '@/hooks/useSingleFlight';

/**
 * Reset password form validation schema
 */
const createResetPasswordSchema = (
  t: (key: string) => string,
  tPassword: (key: string) => string,
) =>
  z
    .object({
      email: z
        .string({ required_error: t('errors.emailRequired') })
        .trim()
        .min(1, t('errors.emailRequired'))
        .email(t('errors.emailInvalid')),
      code: z
        .string({ required_error: t('errors.codeRequired') })
        .trim()
        .length(6, t('errors.codeLength'))
        .regex(/^\d{6}$/, t('errors.codeInvalid')),
      password: createPasswordSchema(tPassword),
      confirmPassword: z
        .string({ required_error: t('errors.confirmRequired') })
        .min(1, t('errors.confirmRequired')),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t('errors.passwordMismatch'),
      path: ['confirmPassword'],
    });

type ResetPasswordFormData = z.infer<ReturnType<typeof createResetPasswordSchema>>;

/**
 * The answers after which the code that was typed can never work: the server
 * found it wrong, expired or locked, or took it and found no account.
 */
const CODE_SPENT_ERRORS: ReadonlySet<string> = new Set([
  ErrorCode.PASSWORD_RESET_CODE_INVALID,
  ErrorCode.USER_NOT_FOUND_FOR_RESET,
]);

/**
 * ResetPasswordForm component for completing password reset
 * Uses 6-digit code sent via email (similar to activation flow)
 *
 * @example
 * <ResetPasswordForm />
 */
export function ResetPasswordForm() {
  const t = useTranslations('auth.resetPassword');
  const tCommon = useTranslations('common');
  const tPassword = useTranslations('auth.passwordRules.errors');
  const tToast = useTranslations('toast');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [resetPassword, { isLoading }] = useResetPasswordMutation();
  const refusalText = useRefusalText();
  const [showRequestNew, setShowRequestNew] = useState(false);

  // Get email from URL params (passed from forgot password page)
  const emailFromUrl = searchParams.get('email') || '';

  // Memoize schema creation when translation function changes
  const resetPasswordSchema = useMemo(
    () => createResetPasswordSchema(t, tPassword),
    [t, tPassword],
  );

  // Initialize form with validation
  const form = useFormWithValidation({
    schema: resetPasswordSchema,
    mode: 'onBlur',
    defaultValues: {
      email: emailFromUrl,
      code: '',
      password: '',
      confirmPassword: '',
    },
  });

  const {
    handleSubmit,
    formState: { errors },
    setError,
    setValue,
  } = form;

  // Redirect to forgot password if no email in URL
  useEffect(() => {
    if (!emailFromUrl) {
      router.push('/auth/forgot-password');
    } else {
      setValue('email', emailFromUrl);
    }
  }, [emailFromUrl, router, setValue]);

  // Memoize submit handler to prevent recreating on every render

  const submit = useCallback(
    async (data: ResetPasswordFormData) => {
      try {
        await showsOwnRefusal(
          resetPassword({
            email: data.email,
            code: data.code,
            newPassword: data.password,
          }),
        ).unwrap();

        // Show success message
        toast.success(tToast('success.passwordReset'));

        // Redirect to login after short delay
        setTimeout(() => {
          router.push('/auth/login');
        }, 1500);
      } catch (err: unknown) {
        const parsed = parseApiError(err);
        // The server answers one code for a wrong, missing, expired or locked
        // code. The person gets one message and can request a new code below.

        if (parsed.code === ErrorCode.PASSWORD_RESET_CODE_INVALID) {
          setShowRequestNew(true);
        }

        setError('root', {
          type: 'manual',
          message: refusalText(err),
        });

        // Any other refusal leaves the code usable, so what was typed stays.
        if (CODE_SPENT_ERRORS.has(parsed.code)) setValue('code', '');
      }
    },
    [refusalText, resetPassword, router, setError, setValue, tToast],
  );
  const onSubmit = useSingleFlight(submit);

  const handleCodeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.target.value = filterDigits(e.target.value, 6);
  }, []);

  return (
    <section className="mt-12 flex flex-col items-center" aria-labelledby="reset-password-heading">
      {/* Title */}
      <Heading
        level={1}
        variant="display"
        id="reset-password-heading"

        data-testid="reset-password-title"
      >
        {t('title')}
      </Heading>

      {/* Subtitle */}
      <Description variant="lead" className="mt-4 text-center max-w-md">
        {t('subtitle')}
      </Description>

      <div className="w-full flex-1 mt-8">
        <FormProvider {...form}>
          <form
            className="mx-auto max-w-xs"
            onSubmit={handleSubmit(onSubmit)}
            data-testid="reset-password-form"
            noValidate
            aria-labelledby="reset-password-heading"
            aria-describedby={errors.root?.message ? 'reset-password-error' : undefined}
          >
            <FormRootError
              id="reset-password-error"
              error={errors.root?.message}
              testId="reset-password-error"
            />

            {/* Email Input (readonly, pre-filled) */}
            <FormInput
              containerClassName={FORM_STYLES.authField}
              name="email"
              data-testid="reset-password-email-input"
              type="email"
              label={t('email')}
              placeholder={tCommon('emailPlaceholder')}
              autoComplete="username"
              busy={isLoading}
              readOnly
              className="bg-muted"
            />

            {/* Code Input */}
            <FormInput
              containerClassName={FORM_STYLES.authField}
              name="code"
              data-testid="reset-password-code-input"
              type="text"
              inputMode="numeric"
              label={t('code')}
              placeholder={tCommon('codePlaceholder')}
              autoComplete="one-time-code"
              busy={isLoading}
              maxLength={6}
              className={cn('text-center tracking-widest', CODE_ENTRY_FONT_SIZE)}
              autoFocus
              onChange={handleCodeChange}
            />

            {/* New Password Input */}
            <FormPassword
              name="password"
              data-testid="reset-password-password-input"
              label={t('password')}
              placeholder={tCommon('passwordPlaceholder')}
              autoComplete="new-password"
              busy={isLoading}
              className={FORM_STYLES.authField}
            />

            <PasswordRules name="password" className="mt-3" />

            {/* Confirm Password Input */}
            <FormPassword
              name="confirmPassword"
              data-testid="reset-password-confirmPassword-input"
              label={t('confirmPassword')}
              placeholder={tCommon('passwordPlaceholder')}
              autoComplete="new-password"
              busy={isLoading}
              className={FORM_STYLES.authField}
            />

            {/* Submit Button */}
            <SubmitButton isLoading={isLoading} icon={KeyRound} testId="reset-password-submit">
              {t('submit')}
            </SubmitButton>

            {/* Request a new code after a rejected one */}
            {showRequestNew && (
              <div className="mt-4 text-center">
                <Link
                  href="/auth/forgot-password"
                  className="text-sm font-semibold text-primary hover:underline transition-colors"
                  data-testid="request-new-code-link"
                  onMouseDown={preventNavigationBlur}
                >
                  {t('requestNewCode')}
                </Link>
              </div>
            )}

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
