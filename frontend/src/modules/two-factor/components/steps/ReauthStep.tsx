'use client';

import { useCallback } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import { FormPassword, SubmitButton } from '@/components/forms';
import { HiddenUsernameField } from '@/modules/auth/components/HiddenUsernameField';

interface ReauthStepProps {
  /** True when the account signs in with a password and should re-enter it. */
  hasPassword: boolean;
  isBusy: boolean;
  onContinue: (password?: string) => void;
}

interface ReauthFormData {
  password: string;
}

/**
 * Step one. An account with a password re-enters it. A passwordless account
 * has nothing to re-enter, so the backend asks for a recent sign-in instead
 * and this is a single button.
 */
export function ReauthStep({ hasPassword, isBusy, onContinue }: ReauthStepProps) {
  const t = useTranslations('settings.twoFactor.setup.reauth');
  const tCommon = useTranslations('common');
  const form = useForm<ReauthFormData>({ defaultValues: { password: '' } });

  const onSubmit = useCallback(
    (data: ReauthFormData) => onContinue(data.password || undefined),
    [onContinue],
  );

  if (!hasPassword) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('passwordlessBody')}</p>
        <SubmitButton
          isLoading={isBusy}
          icon={ShieldCheck}
          className="h-10 mt-0 w-full py-2"
          testId="two-factor-reauth-continue"
          onClick={() => onContinue()}
          type="button"
        >
          {t('continue')}
        </SubmitButton>
      </div>
    );
  }

  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4"
        data-testid="two-factor-reauth-form"
        noValidate
      >
        <HiddenUsernameField />
        <p className="text-sm text-muted-foreground">{t('passwordBody')}</p>
        <FormPassword<ReauthFormData>
          name="password"
          label={t('password')}
          placeholder={tCommon('passwordPlaceholder')}
          autoComplete="current-password"
          busy={isBusy}
          data-testid="two-factor-reauth-password"
        />
        <SubmitButton
          isLoading={isBusy}
          icon={ShieldCheck}
          className="h-10 mt-0 w-full py-2"
          testId="two-factor-reauth-submit"
        >
          {t('continue')}
        </SubmitButton>
      </form>
    </FormProvider>
  );
}
