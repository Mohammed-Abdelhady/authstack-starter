'use client';

import { Description, Heading } from '@/components/design-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { ErrorCode } from '@app/core';
import { useCompleteSignIn } from '@/modules/auth/hooks/useCompleteSignIn';
import { useFeatureDisabledHandler } from '@/modules/auth/hooks/useFeatureDisabled';
import { translatableErrorCode } from '@/modules/auth/utils/errorCodeMessage';
import { selectUser } from '@/modules/auth/store/authSlice';
import { useAppSelector } from '@/store/hooks';
import { useSingleFlight } from '@/hooks/useSingleFlight';
import { useVerifyMagicLinkMutation, type MagicLinkVerifyResponse } from './magicLinkApi';

interface MagicLinkVerifyPanelProps {
  /** Token from the query string of the mailed link. */
  token: string;
  redirect: string | null;
}

/**
 * Spends a sign-in link.
 *
 * The token works once, so the request has to fire once. A ref guards it
 * against the double effect run of React strict mode, which would otherwise
 * burn the token on the first render and fail on the second.
 */
export function MagicLinkVerifyPanel({ token, redirect }: MagicLinkVerifyPanelProps) {
  const t = useTranslations('auth.magicLink.verify');
  const tCodes = useTranslations('errors.codes');
  const [verifyMagicLink, { isLoading }] = useVerifyMagicLinkMutation();
  const completeSignIn = useCompleteSignIn();
  const handleFeatureDisabled = useFeatureDisabledHandler();
  const currentUser = useAppSelector(selectUser);
  const hasStarted = useRef(false);
  const [failureCode, setFailureCode] = useState<string | null>(
    token.length === 0 ? ErrorCode.MAGIC_LINK_INVALID : null,
  );
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);

  const acceptSignIn = useCallback(
    async (response: MagicLinkVerifyResponse) => {
      if ('requiresConfirmation' in response) {
        setConfirmationEmail(response.email);
        return;
      }
      await completeSignIn(response, response.redirect ?? redirect);
    },
    [completeSignIn, redirect],
  );

  const recordFailure = useCallback(
    (error: unknown) => {
      handleFeatureDisabled(error);
      setFailureCode(translatableErrorCode(error, ErrorCode.MAGIC_LINK_INVALID));
    },
    [handleFeatureDisabled],
  );

  useEffect(() => {
    if (token.length === 0 || hasStarted.current) {
      return;
    }
    hasStarted.current = true;

    verifyMagicLink({ token }).unwrap().then(acceptSignIn).catch(recordFailure);
  }, [acceptSignIn, recordFailure, token, verifyMagicLink]);

  const confirmOnce = useCallback(async () => {
    setFailureCode(null);
    try {
      await acceptSignIn(await verifyMagicLink({ token, confirm: true }).unwrap());
    } catch (error: unknown) {
      recordFailure(error);
    }
  }, [acceptSignIn, recordFailure, token, verifyMagicLink]);
  const confirmForwardedLink = useSingleFlight(confirmOnce);

  if (failureCode === null) {
    if (confirmationEmail !== null) {
      return (
        <section
          className="mt-12 flex flex-col items-center text-center"
          data-testid="magic-link-verify-confirmation"
        >
          <div role="status">
            <Heading level={1} variant="display" className="mt-4">
              {t('confirmation.title')}
            </Heading>
            <Description variant="lead" className="mt-2 max-w-sm">
              {t('confirmation.linkTarget', { email: confirmationEmail })}
            </Description>
            {currentUser !== null && (
              <Description className="mt-3 max-w-sm" data-testid="magic-link-current-account">
                {t('confirmation.currentAccount', { email: currentUser.email })}
              </Description>
            )}
          </div>
          <Button
            type="button"
            className="mt-6 w-full max-w-xs"
            busy={isLoading}
            aria-busy={isLoading}
            onClick={confirmForwardedLink}
            data-testid="magic-link-confirm-forwarded"
          >
            {t('confirmation.continue')}
          </Button>
          <Link
            href="/auth/login"
            className="mt-3 text-sm text-primary hover:underline"
            data-testid="magic-link-back-to-sign-in"
          >
            {t('backToSignIn')}
          </Link>
        </section>
      );
    }

    return (
      <section
        className="mt-12 flex flex-col items-center text-center"
        aria-live="polite"
        data-testid="magic-link-verify-pending"
      >
        <Loader2 className="h-8 w-8 motion-safe:animate-spin text-primary" aria-hidden="true" />
        <Heading level={1} variant="display" className="mt-4">
          {t('title')}
        </Heading>
        <Description variant="lead" className="mt-2">
          {t('pending')}
        </Description>
      </section>
    );
  }

  return (
    <section
      className="mt-12 flex flex-col items-center text-center"
      data-testid="magic-link-verify-error"
    >
      <div role="alert">
        <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
        <Heading level={1} variant="display" className="mt-4">
          {t('errorTitle')}
        </Heading>
        <Description variant="lead" className="mt-2 max-w-sm">
          {tCodes(failureCode)}
        </Description>
      </div>

      <Button asChild className="mt-6 w-full max-w-xs" data-testid="magic-link-request-new">
        <Link href="/auth/login">{t('requestNew')}</Link>
      </Button>
      <Link
        href="/auth/login"
        className="mt-3 text-sm text-primary hover:underline"
        data-testid="magic-link-back-to-sign-in"
      >
        {t('backToSignIn')}
      </Link>
    </section>
  );
}
