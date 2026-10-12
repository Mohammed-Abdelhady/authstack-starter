'use client';

import { Description, Heading } from '@/components/design-system';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusHandOff } from '@/hooks/useFocusHandOff';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { FormProvider } from 'react-hook-form';
import { MailCheck, Send } from 'lucide-react';
import { useFormWithValidation } from '@/hooks/useFormWithValidation';
import { FormInput, FormRootError, SubmitButton } from '@/components/forms';
import { Button } from '@/components/ui/button';
import { zodEmail } from '@app/core';
import { useCooldown } from '@/modules/auth/hooks/useCooldown';
import { useValidateFilledOnBlur } from '@/modules/auth/hooks/useValidateFilledOnBlur';
import { useFeatureDisabledHandler } from '@/modules/auth/hooks/useFeatureDisabled';
import { isNativeAuthorizeContinuation } from '@/modules/auth/constants/nativeAuthorize';
import { getRedirectPath } from '@/modules/auth/utils';
import { useRefusalText } from '@/hooks/useRefusalText';
import { showsOwnRefusal } from '@/lib/refusal';
import type { AuthMethodFormProps } from '../types';
import { useRequestMagicLinkMutation } from './magicLinkApi';
import { useSingleFlight } from '@/hooks/useSingleFlight';

/** Seconds before the same address may ask for another link. */
const RESEND_COOLDOWN_SECONDS = 60;

/** @param tSignIn - The sign-in page's messages, so both of its forms word an address error alike */
const createMagicLinkSchema = (tSignIn: (key: string) => string) =>
  z.object({
    email: zodEmail({
      required: true,
      messages: {
        required: tSignIn('errors.emailRequired'),
        invalid: tSignIn('errors.emailInvalid'),
      },
    }),
  });

type MagicLinkFormData = z.infer<ReturnType<typeof createMagicLinkSchema>>;

/**
 * Asks for a one-time sign-in link.
 *
 * The confirmation says a link is on its way whatever the backend did, which
 * matches a reply that is deliberately the same for every address.
 */
export function MagicLinkRequestForm({ isOnlyMethod, redirect }: AuthMethodFormProps) {
  const t = useTranslations('auth.magicLink');
  const tSignIn = useTranslations('auth.login');
  const tCommon = useTranslations('common');
  const refusalText = useRefusalText();
  const [requestMagicLink, { isLoading }] = useRequestMagicLinkMutation();
  const handleFeatureDisabled = useFeatureDisabledHandler();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { secondsLeft, isCooling, start: startCooldown } = useCooldown(RESEND_COOLDOWN_SECONDS);

  const schema = useMemo(() => createMagicLinkSchema(tSignIn), [tSignIn]);
  const form = useFormWithValidation({
    schema,
    defaultValues: { email: '' },
    mode: 'onSubmit',
  });
  const onEmailBlur = useValidateFilledOnBlur(form, 'email');

  const {
    handleSubmit,
    formState: { errors },
    setError,
    getValues,
  } = form;

  // The form gives way to the confirmation, which then takes the focus.
  const sentHeadingRef = useRef<HTMLHeadingElement>(null);
  const { arm, handTo } = useFocusHandOff();
  useEffect(() => {
    if (sentTo !== null) handTo(sentHeadingRef.current);
  }, [handTo, sentTo]);

  const sendLink = useCallback(
    async (email: string) => {
      // Only the native authorize continuation is worth carrying through the
      // link, and only its validated value is sent, never the raw query string.
      const validated = getRedirectPath(redirect, '');
      const continuation = isNativeAuthorizeContinuation(validated) ? validated : undefined;
      try {
        arm();
        await showsOwnRefusal(requestMagicLink({ email, redirect: continuation })).unwrap();
        setSentTo(email);
        startCooldown();
      } catch (err) {
        // The gate takes this form off the page once the refetch lands.
        if (handleFeatureDisabled(err)) {
          return;
        }
        setError('root', { type: 'manual', message: refusalText(err) });
      }
    },
    [arm, handleFeatureDisabled, redirect, refusalText, requestMagicLink, setError, startCooldown],
  );
  const send = useSingleFlight(sendLink);

  const onSubmit = useCallback(async (data: MagicLinkFormData) => send(data.email), [send]);

  const onResend = useCallback(() => send(getValues('email')), [getValues, send]);

  if (sentTo !== null) {
    return (
      <div className="mx-auto max-w-xs text-center" data-testid="magic-link-sent">
        <div role="status">
          <MailCheck className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
          <Heading
            level={2}
            variant="sectionTitle"
            className="mt-3"
            ref={sentHeadingRef}
            tabIndex={-1}
          >
            {t('sentTitle')}
          </Heading>
          <Description className="mt-2">{t('sentBody', { email: sentTo })}</Description>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="mt-4 w-full"
          onClick={onResend}
          busy={isLoading || isCooling}
          aria-busy={isLoading}
          data-testid="magic-link-resend"
        >
          {isCooling ? t('resendCooldown', { seconds: secondsLeft }) : t('resend')}
        </Button>
      </div>
    );
  }

  return (
    <FormProvider {...form}>
      <form
        className="mx-auto max-w-xs"
        onSubmit={handleSubmit(onSubmit)}
        data-testid="magic-link-form"
        noValidate
        aria-label={t('title')}
      >
        {!isOnlyMethod && (
          <p className="mb-3 text-center text-sm text-muted-foreground">{t('description')}</p>
        )}

        <FormRootError
          id="magic-link-error"
          error={errors.root?.message}
          testId="magic-link-error"
        />

        <FormInput
          name="email"
          type="email"
          label={t('email')}
          placeholder={tCommon('emailPlaceholder')}
          autoComplete="email"
          required
          busy={isLoading}
          autoFocus={isOnlyMethod}
          onBlur={onEmailBlur}
          data-testid="magic-link-email-input"
        />

        <SubmitButton isLoading={isLoading} icon={Send} testId="magic-link-submit">
          {t('submit')}
        </SubmitButton>
      </form>
    </FormProvider>
  );
}
