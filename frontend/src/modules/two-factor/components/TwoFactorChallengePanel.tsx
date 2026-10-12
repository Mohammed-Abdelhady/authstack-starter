'use client';

import { Description, Heading } from '@/components/design-system';
import { ErrorCode } from '@app/core';
import { useCallback, useMemo, useState } from 'react';
import { FormProvider } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import { useFormWithValidation } from '@/hooks/useFormWithValidation';
import { FormRootError, SubmitButton } from '@/components/forms';
import { Link } from '@/i18n/navigation';
import { useCompleteSignIn } from '@/modules/auth/hooks/useCompleteSignIn';
import { useFeatureDisabledHandler } from '@/modules/auth/hooks/useFeatureDisabled';
import { translatableErrorCode } from '@/modules/auth/utils/errorCodeMessage';
import { PasskeyChallengeButton } from '@/modules/passkeys'; // feature:passkeys
import { useVerifyTwoFactorMutation } from '../api';
import { createAnswerSchema, toAnswer, type AnswerFormData } from '../utils/answerSchema';
import { TwoFactorAnswerFields } from './TwoFactorAnswerFields';
import { useSingleFlight } from '@/hooks/useSingleFlight';
import { useTwoFactorLockCountdown } from '@/modules/auth/hooks/useTwoFactorLockCountdown';

interface TwoFactorChallengePanelProps {
  redirect: string | null;
}

/**
 * The second half of a sign-in that was held for a code.
 *
 * The challenge cookie is already set, so this only collects the answer and
 * finishes the sign-in the same way the password form does.
 */
export function TwoFactorChallengePanel({ redirect }: TwoFactorChallengePanelProps) {
  const t = useTranslations('auth.twoFactor');
  const tCodes = useTranslations('errors.codes');
  const [verify, { isLoading }] = useVerifyTwoFactorMutation();
  const completeSignIn = useCompleteSignIn();
  const handleFeatureDisabled = useFeatureDisabledHandler();
  const { isCooling, secondsLeft, startForError } = useTwoFactorLockCountdown();
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  const schema = useMemo(() => createAnswerSchema(t), [t]);
  const form = useFormWithValidation({
    schema,
    defaultValues: { code: '', recoveryCode: '' },
    mode: 'onSubmit',
  });

  const {
    handleSubmit,
    formState: { errors },
    setError,
    resetField,
  } = form;

  const onToggle = useCallback(() => {
    resetField('code');
    resetField('recoveryCode');
    setUseRecoveryCode((current) => !current);
  }, [resetField]);

  const submit = useCallback(
    async (data: AnswerFormData) => {
      if (isCooling) return;
      try {
        const response = await verify(toAnswer(data)).unwrap();
        await completeSignIn(response, redirect);
      } catch (err) {
        if (handleFeatureDisabled(err) || startForError(err)) return;
        const code = translatableErrorCode(err);
        const message = code === ErrorCode.TWO_FACTOR_LOCKED ? t('locked') : tCodes(code);
        setError('root', { type: 'manual', message });
      }
    },
    [
      completeSignIn,
      handleFeatureDisabled,
      isCooling,
      startForError,
      redirect,
      setError,
      t,
      tCodes,
      verify,
    ],
  );
  const onSubmit = useSingleFlight(submit);

  return (
    <section className="mt-12 flex flex-col items-center" aria-labelledby="two-factor-heading">
      <Heading
        level={1}
        variant="display"
        id="two-factor-heading"

        data-testid="two-factor-title"
      >
        {t('title')}
      </Heading>
      <Description variant="lead" className="mt-4 max-w-sm text-center">
        {t('description')}
      </Description>

      <FormProvider {...form}>
        <form
          className="mt-8 w-full max-w-xs"
          onSubmit={handleSubmit(onSubmit)}
          data-testid="two-factor-form"
          noValidate
          aria-labelledby="two-factor-heading"
        >
          <FormRootError
            id="two-factor-error"
            error={
              isCooling ? t('lockedCountdown', { seconds: secondsLeft }) : errors.root?.message
            }
            testId="two-factor-error"
          />

          <TwoFactorAnswerFields
            useRecoveryCode={useRecoveryCode}
            onToggle={onToggle}
            isBusy={isLoading}
          />

          <SubmitButton
            isLoading={isLoading}
            disabled={isCooling}
            icon={ShieldCheck}
            testId="two-factor-submit"
          >
            {t('submit')}
          </SubmitButton>
        </form>
      </FormProvider>

      {/* feature:passkeys:start */}
      <PasskeyChallengeButton redirect={redirect} />
      {/* feature:passkeys:end */}

      <Link
        href="/auth/login"
        className="mt-6 text-sm text-primary hover:underline"
        data-testid="two-factor-back-to-sign-in"
      >
        {t('backToSignIn')}
      </Link>
    </section>
  );
}
