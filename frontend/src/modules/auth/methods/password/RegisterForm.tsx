'use client';

import { Description } from '@/components/design-system';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { z } from 'zod';
import { FormProvider } from 'react-hook-form';
import { FORM_STYLES } from '@/lib/config/form-styles';
import { useFormWithValidation } from '@/hooks/useFormWithValidation';
import { useFormFieldTarget, useServerFieldErrors } from '@/hooks/useServerFieldErrors';
import { translatableErrorCode } from '@/modules/auth/utils/errorCodeMessage';
import { FormInput, FormRootError, SubmitButton } from '@/components/forms';
import { useRegisterMutation } from '@/modules/auth/store/authApi';
import { zodEmail } from '@app/core';
import { UserPlus, LogIn } from 'lucide-react';
import { IconLinkButton } from '@/components/ui/icon-link-button';
import { useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAppDispatch } from '@/store/hooks';
import { rememberRegistrationEmail } from '@/modules/auth/store/authSlice';
import {
  ACTIVATE_PATH,
  LOGIN_PATH,
  REDIRECT_PARAM,
  AUTH_EMAIL_MAX_LENGTH,
} from '@/modules/auth/constants/authMethods';
import { getRedirectPath } from '@/modules/auth/utils/authHelpers';
import { authPagePath } from '@/modules/auth/utils/signInRouting';
import { toast } from '@/lib/toast';
import { useSingleFlight } from '@/hooks/useSingleFlight';
import { AuthDivider } from '@/components/ui/auth-divider'; // feature:oauth-core
import { OAuthButtons } from '@/modules/oauth'; // feature:oauth-core
import { useAuthMethods } from '@/modules/auth/hooks/useAuthMethods'; // feature:oauth-core

/**
 * Registration form validation schema using centralized validators
 */
const createRegisterSchema = (t: (key: string) => string) =>
  z.object({
    email: zodEmail({
      required: true,
      messages: {
        required: t('errors.emailRequired'),
        invalid: t('errors.emailInvalid'),
      },
    }).max(AUTH_EMAIL_MAX_LENGTH, t('errors.emailInvalid')),
  });

type RegisterFormData = z.infer<ReturnType<typeof createRegisterSchema>>;

/**
 * RegisterForm component with validation and API integration
 * Optimized for performance with memoization and minimal re-renders
 *
 * @example
 * <RegisterForm />
 */
export function RegisterForm() {
  const t = useTranslations('auth.register');
  const tToast = useTranslations('toast');
  const tCodes = useTranslations('errors.codes');
  const router = useRouter();
  const dispatch = useAppDispatch();
  const redirect = getRedirectPath(useSearchParams().get(REDIRECT_PARAM), '');
  const [register, { isLoading }] = useRegisterMutation();
  const { methods } = useAuthMethods(); // feature:oauth-core
  const hasOAuth = (methods?.oauth.length ?? 0) > 0; // feature:oauth-core

  // Memoize schema creation when translation function changes
  const registerSchema = useMemo(() => createRegisterSchema(t), [t]);

  // Initialize form with validation
  const form = useFormWithValidation({
    schema: registerSchema,
    defaultValues: {
      email: '',
    },
    mode: 'onBlur',
  });

  const {
    handleSubmit,
    formState: { errors },
    setError,
  } = form;
  const formRef = useRef<HTMLFormElement>(null);
  const applyServerFieldErrors = useServerFieldErrors(
    useFormFieldTarget(setError, formRef),
    isLoading,
  );

  // Memoize submit handler to prevent recreating on every render
  const submit = useCallback(
    async (data: RegisterFormData) => {
      try {
        const result = await register({
          email: data.email,
        }).unwrap();

        // Successful registration - show toast and redirect to activation
        toast.success(tToast('success.registrationSuccess'));
        dispatch(rememberRegistrationEmail(result.data.email));
        router.push(authPagePath(ACTIVATE_PATH, redirect));
      } catch (err: unknown) {
        applyServerFieldErrors(err);
        const code = translatableErrorCode(err, '');
        let errorMessage = t('errors.serverError');

        if (code) errorMessage = tCodes(code);

        setError('root', {
          type: 'manual',
          message: errorMessage,
        });
      }
    },
    [applyServerFieldErrors, dispatch, redirect, register, router, setError, t, tCodes, tToast],
  );
  const onSubmit = useSingleFlight(submit);

  return (
    <div className="flex flex-col items-center">
      <Description variant="lead" className="mt-4 text-center max-w-md">
        {t('description')}
      </Description>

      <div className="w-full flex-1 mt-8">
        {/* Sign In Link */}
        <div className="flex flex-col items-center">
          <IconLinkButton
            href={authPagePath(LOGIN_PATH, redirect)}
            icon={LogIn}
            variant="secondary"
            testId="signin-link"
            aria-label={t('signIn')}
          >
            {t('signIn')}
          </IconLinkButton>
        </div>

        {/* feature:oauth-core:start */}
        {/* OAuth buttons, only where the backend has providers configured */}
        {hasOAuth && (
          <>
            <div className="my-6">
              <OAuthButtons redirect={redirect || undefined} />
            </div>
            <AuthDivider />
          </>
        )}
        {/* feature:oauth-core:end */}

        {/* Registration Form */}
        <FormProvider {...form}>
          <form
            ref={formRef}
            className="mx-auto max-w-xs relative"
            onSubmit={handleSubmit(onSubmit)}
            data-testid="register-form"
            noValidate
            aria-labelledby="register-heading"
            aria-describedby={errors.root?.message ? 'register-error' : undefined}
          >
            <FormRootError
              id="register-error"
              error={errors.root?.message}
              testId="register-error"
            />

            {/* Email Input */}
            <FormInput
              containerClassName={FORM_STYLES.authField}
              name="email"
              data-testid="register-email-input"
              type="email"
              label={t('email')}
              placeholder={t('emailPlaceholder')}
              autoComplete="email"
              disabled={isLoading}
              autoFocus
            />

            {/* Submit Button */}
            <SubmitButton isLoading={isLoading} icon={UserPlus} testId="register-submit">
              {t('submit')}
            </SubmitButton>
          </form>
        </FormProvider>
      </div>
    </div>
  );
}
