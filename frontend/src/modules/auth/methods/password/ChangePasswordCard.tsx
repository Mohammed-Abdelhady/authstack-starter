'use client';

import { useMemo, useRef } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from '@/lib/toast';
import { reportUnlessHandled } from '@/lib/requestFailure';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormPassword, PasswordRules, SubmitButton } from '@/components/forms';
import { useChangePasswordMutation } from '@/modules/auth/store';
import { AuthMethodsLoadErrorCard } from '@/modules/auth/components/AuthMethodsLoadError';
import { useAuthMethods } from '@/modules/auth/hooks/useAuthMethods';
import { HiddenUsernameField } from '@/modules/auth/components/HiddenUsernameField';
import { useFormFieldTarget, useServerFieldErrors } from '@/hooks/useServerFieldErrors';
import type { ChangePasswordFormData } from '@app/core';
import { createChangePasswordSchema } from './changePasswordSchema';
import { useSingleFlight } from '@/hooks/useSingleFlight';
import { useRefusalToast } from '@/hooks/useRefusalToast';

/**
 * Password change, for the settings page.
 *
 * A deployment with password sign-in turned off has no password to change, so
 * the card is not rendered there. Not knowing whether it is off is a failure
 * with a retry, not a card that is gone.
 */
export function ChangePasswordCard() {
  const t = useTranslations('settings.password');
  const tCommon = useTranslations('common');
  const tPassword = useTranslations('auth.passwordRules.errors');
  const { methods, isError: methodsFailed, retry, hasRetried } = useAuthMethods();
  const [changePassword, { isLoading }] = useChangePasswordMutation();
  const refusalToast = useRefusalToast();

  const schema = useMemo(() => createChangePasswordSchema(t, tPassword), [t, tPassword]);

  const form = useForm<ChangePasswordFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });
  const formRef = useRef<HTMLFormElement>(null);
  const applyServerFieldErrors = useServerFieldErrors(
    useFormFieldTarget(form.setError, formRef),
    isLoading,
  );

  const submit = async (data: ChangePasswordFormData) => {
    refusalToast.clearStale();
    try {
      await changePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      }).unwrap();

      toast.success(t('success'));
      form.reset();
    } catch (error) {
      refusalToast.noteRefusal();
      applyServerFieldErrors(error);
      reportUnlessHandled(error);
    }
  };
  const onSubmit = useSingleFlight(submit);

  if (methodsFailed) {
    return (
      <AuthMethodsLoadErrorCard
        title={t('title')}
        onRetry={retry}
        takeFocus={hasRetried}
        testId="change-password-card-error"
      />
    );
  }

  if (methods !== undefined && !methods.password) {
    return null;
  }

  return (
    <Card data-testid="change-password-card">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <FormProvider {...form}>
          <form
            ref={formRef}
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            data-testid="change-password-form"
          >
            <HiddenUsernameField />
            <FormPassword<ChangePasswordFormData>
              name="currentPassword"
              label={t('currentPassword')}
              placeholder={tCommon('passwordPlaceholder')}
              autoComplete="current-password"
              disabled={isLoading}
              data-testid="current-password-input"
            />

            <FormPassword<ChangePasswordFormData>
              name="newPassword"
              label={t('newPassword')}
              placeholder={tCommon('passwordPlaceholder')}
              autoComplete="new-password"
              disabled={isLoading}
              data-testid="new-password-input"
            />

            <PasswordRules name="newPassword" className="mt-2" />

            <FormPassword<ChangePasswordFormData>
              name="confirmPassword"
              label={t('confirmPassword')}
              placeholder={tCommon('passwordPlaceholder')}
              autoComplete="new-password"
              disabled={isLoading}
              data-testid="confirm-password-input"
            />

            <SubmitButton
              isLoading={isLoading}
              className="h-10 mt-0 w-full py-2"
              testId="change-password-submit"
            >
              {t('submit')}
            </SubmitButton>
          </form>
        </FormProvider>
      </CardContent>
    </Card>
  );
}
