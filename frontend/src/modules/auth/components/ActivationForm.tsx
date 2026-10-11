'use client';

import { Description, Heading } from '@/components/design-system';
import { useTranslations } from 'next-intl';
import { FormProvider } from 'react-hook-form';
import {
  FormInput,
  FormPassword,
  PasswordRules,
  FormRootError,
  SubmitButton,
} from '@/components/forms';
import { ShieldCheck, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authPagePath } from '../utils/signInRouting';
import { REGISTER_PATH, LOGIN_PATH, VERIFICATION_CODE_LENGTH } from '../constants/authMethods';
import { Link } from '@/i18n/navigation';
import { CODE_ENTRY_FONT_SIZE, FORM_STYLES } from '@/lib/config/form-styles';
import { cn } from '@/lib/utils';
import { useActivationForm } from '../hooks/useActivationForm';
import { AuthCompletionNotice } from './AuthCompletionNotice';

export function ActivationForm() {
  const t = useTranslations('auth.activate');
  const tCommon = useTranslations('common');
  const {
    form,
    formRef,
    onSubmit,
    handleResend,
    handleCodeChange,
    isLoading,
    isResending,
    isResendDisabled,
    cooldownSeconds,
    showRegisterAgain,
    mustSignIn,
    emailInMemory,
    redirect,
  } = useActivationForm();
  const {
    handleSubmit,
    formState: { errors },
  } = form;

  if (mustSignIn) {
    return (
      <AuthCompletionNotice
        title={t('accountCreated')}
        message={t('signInRequired')}
        href={authPagePath(LOGIN_PATH, redirect)}
        actionLabel={t('signIn')}
        testId="activate-signin-notice"
        actionTestId="activate-signin"
      />
    );
  }

  return (
    <section className="mt-12 flex flex-col items-center" aria-labelledby="activate-heading">
      {/* Title */}
      <Heading
        level={1}
        variant="display"
        id="activate-heading"

        data-testid="activate-title"
      >
        {t('title')}
      </Heading>

      {/* Description */}
      <Description variant="lead" className="mt-4 text-center max-w-md">
        {t('description')}
      </Description>

      <div className="w-full flex-1 mt-8">
        {/* Activation Form */}
        <FormProvider {...form}>
          <form
            ref={formRef}
            className="mx-auto max-w-xs"
            onSubmit={handleSubmit(onSubmit)}
            data-testid="activate-form"
            noValidate
            aria-labelledby="activate-heading"
            aria-describedby={errors.root?.message ? 'activate-error' : undefined}
          >
            <FormRootError
              id="activate-error"
              error={errors.root?.message}
              testId="activate-error"
            />

            {/* Email Input (readonly, pre-filled) */}
            <FormInput
              containerClassName={FORM_STYLES.authField}
              name="email"
              type="email"
              label={t('email')}
              placeholder={t('emailPlaceholder')}
              autoComplete="username"
              disabled={isLoading || isResending}
              data-testid="activate-email-input"
              readOnly={Boolean(emailInMemory)}
              className={emailInMemory ? 'bg-muted' : undefined}
              autoFocus={!emailInMemory}
            />

            {/* Code Input */}
            <FormInput
              containerClassName={FORM_STYLES.authField}
              name="code"
              data-testid="activate-code-input"
              type="text"
              inputMode="numeric"
              label={t('code')}
              placeholder={t('codePlaceholder')}
              autoComplete="one-time-code"
              disabled={isLoading || isResending}
              maxLength={VERIFICATION_CODE_LENGTH}
              className={cn('text-center tracking-widest', CODE_ENTRY_FONT_SIZE)}
              autoFocus={Boolean(emailInMemory)}
              onChange={handleCodeChange}
            />

            <FormInput
              containerClassName={FORM_STYLES.authField}
              name="name"
              data-testid="activate-name-input"
              label={t('name')}
              placeholder={t('namePlaceholder')}
              autoComplete="name"
              disabled={isLoading || isResending}
            />
            <FormPassword
              name="password"
              data-testid="activate-password-input"
              label={t('password')}
              placeholder={tCommon('passwordPlaceholder')}
              autoComplete="new-password"
              disabled={isLoading || isResending}
              className={FORM_STYLES.authField}
            />
            <PasswordRules name="password" className="mt-3" />
            <FormPassword
              name="confirmPassword"
              data-testid="activate-confirm-password-input"
              label={t('confirmPassword')}
              placeholder={tCommon('passwordPlaceholder')}
              autoComplete="new-password"
              disabled={isLoading || isResending}
              className={FORM_STYLES.authField}
            />

            {/* Submit Button */}
            <SubmitButton
              isLoading={isLoading || isResending}
              icon={ShieldCheck}
              testId="activate-submit"
            >
              {t('submit')}
            </SubmitButton>

            {/* Resend Code Button */}
            <Button
              type="button"
              onClick={handleResend}
              disabled={isResendDisabled}
              variant="ghost"
              className="mt-4 w-full flex items-center justify-center gap-2"
              data-testid="resend-button"
              aria-label={
                isResending
                  ? t('resendSending')
                  : cooldownSeconds > 0
                    ? t('resendCooldown', { seconds: cooldownSeconds })
                    : t('resendButton')
              }
              aria-busy={isResending || cooldownSeconds > 0}
            >
              <RefreshCw
                className={`w-4 h-4 ${isResending || cooldownSeconds > 0 ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>
                {isResending
                  ? t('resendSending')
                  : cooldownSeconds > 0
                    ? t('resendCooldown', { seconds: cooldownSeconds })
                    : t('resendButton')}
              </span>
            </Button>

            {/* Register again after a rejected code */}
            {showRegisterAgain && (
              <div className="mt-4 text-center">
                <Link
                  href={authPagePath(REGISTER_PATH, redirect)}
                  className="text-sm font-semibold text-primary hover:underline transition-colors"
                  data-testid="register-again-link"
                >
                  {t('registerAgain')}
                </Link>
              </div>
            )}
          </form>
        </FormProvider>
      </div>
    </section>
  );
}
