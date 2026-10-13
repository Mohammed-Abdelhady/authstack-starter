'use client';

import { Description, Heading } from '@/components/design-system';
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { LOGIN_PATH, REDIRECT_PARAM } from '@/modules/auth/constants/authMethods';
import { signedInPath } from '@/modules/auth/utils/signInRouting';
import { useTranslations } from 'next-intl';
import { LogIn } from 'lucide-react';
import { IconLinkButton } from '@/components/ui/icon-link-button';
import { useRouter } from '@/i18n/navigation';
import { useAppSelector } from '@/store/hooks';
import { selectIsAuthenticated, selectUser } from '@/modules/auth/store/authSlice';
import { AuthLayout } from '@/modules/auth/components/AuthLayout';
import { AuthMethodsGate } from '@/modules/auth/components/AuthMethodsGate';
import { RegisterForm } from './RegisterForm';
import { NATIVE_BROWSER_FLOW } from '@/modules/auth/constants/nativeBrowserSelectors';
import {
  isNativeBrowserGuestJourney,
  nativeBrowserJourneyPath,
} from '@/modules/auth/utils/nativeBrowserJourney';
import { readNativeBrowserGuestFlow } from '@/modules/auth/utils/nativeBrowserSelectors';

interface NoPasswordHintProps {
  /** True when a mailed link is what creates the account. */
  createsAccountByLink: boolean;
}

/** Registration guidance when password sign-up is unavailable. */
function NoPasswordHint({ createsAccountByLink }: NoPasswordHintProps) {
  const t = useTranslations('auth.register');
  const searchParams = useSearchParams();
  const redirect = searchParams.get(REDIRECT_PARAM);
  const flow = readNativeBrowserGuestFlow(searchParams);
  const suffix = createsAccountByLink ? 'magicLinkOnly' : 'providerOnly';

  return (
    <div className="mx-auto mt-8 max-w-xs text-center" data-testid="register-no-password-hint">
      <Heading level={2} variant="sectionTitle">
        {t(`${suffix}Title`)}
      </Heading>
      <Description className="mt-2">{t(`${suffix}Body`)}</Description>
      <IconLinkButton
        href={nativeBrowserJourneyPath(LOGIN_PATH, redirect, flow)}
        icon={LogIn}
        variant="secondary"
        testId="register-sign-in-link"
        className="mt-4"
        aria-label={t('signIn')}
      >
        {t('signIn')}
      </IconLinkButton>
    </div>
  );
}

/**
 * Registration screen.
 *
 * The form only makes sense where passwords are on. Where the sign-in link is
 * the way in, it creates the account by itself, so this points at sign-in
 * instead of offering a second path.
 */
export function RegisterPage() {
  const t = useTranslations('auth.register');
  const router = useRouter();
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const user = useAppSelector(selectUser);
  const searchParams = useSearchParams();
  const redirect = searchParams.get(REDIRECT_PARAM);
  const explicitJourney = isNativeBrowserGuestJourney(
    redirect,
    readNativeBrowserGuestFlow(searchParams),
    NATIVE_BROWSER_FLOW.REGISTRATION,
  );

  useEffect(() => {
    if (isAuthenticated && user && !explicitJourney) {
      router.replace(signedInPath(user, redirect));
    }
  }, [explicitJourney, isAuthenticated, user, redirect, router]);

  if (isAuthenticated && !explicitJourney) {
    return null;
  }

  return (
    <AuthLayout>
      {/* The heading stays while the sign-in options load, fail or leave no form. */}
      <section className="mt-12 flex flex-col items-center" aria-labelledby="register-heading">
        <Heading level={1} variant="display" id="register-heading" data-testid="register-title">
          {t('title')}
        </Heading>
        <div className="w-full flex-1">
          <AuthMethodsGate>
            {(methods) =>
              methods.password ? (
                <RegisterForm />
              ) : (
                <NoPasswordHint createsAccountByLink={methods.magicLink} />
              )
            }
          </AuthMethodsGate>
        </div>
      </section>
    </AuthLayout>
  );
}
