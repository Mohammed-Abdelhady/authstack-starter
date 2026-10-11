'use client';

import { Description, Heading } from '@/components/design-system';
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { LOGIN_PATH, REDIRECT_PARAM } from '@/modules/auth/constants/authMethods';
import { authPagePath, signedInPath } from '@/modules/auth/utils/signInRouting';
import { useTranslations } from 'next-intl';
import { LogIn } from 'lucide-react';
import { IconLinkButton } from '@/components/ui/icon-link-button';
import { useRouter } from '@/i18n/navigation';
import { useAppSelector } from '@/store/hooks';
import { selectIsAuthenticated, selectUser } from '@/modules/auth/store/authSlice';
import { AuthLayout } from '@/modules/auth/components/AuthLayout';
import { AuthMethodsGate } from '@/modules/auth/components/AuthMethodsGate';
import { RegisterForm } from './RegisterForm';

interface NoPasswordHintProps {
  /** True when a mailed link is what creates the account. */
  createsAccountByLink: boolean;
}

/**
 * Shown where passwords are off. A magic link creates the account by itself;
 * with only OAuth left, the provider does, so the copy differs.
 */
function NoPasswordHint({ createsAccountByLink }: NoPasswordHintProps) {
  const t = useTranslations('auth.register');
  const redirect = useSearchParams().get(REDIRECT_PARAM);
  const suffix = createsAccountByLink ? 'magicLinkOnly' : 'providerOnly';

  return (
    <div className="mx-auto mt-8 max-w-xs text-center" data-testid="register-no-password-hint">
      <Heading level={2} variant="sectionTitle">
        {t(`${suffix}Title`)}
      </Heading>
      <Description className="mt-2">{t(`${suffix}Body`)}</Description>
      <IconLinkButton
        href={authPagePath(LOGIN_PATH, redirect)}
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
  const redirect = useSearchParams().get(REDIRECT_PARAM);

  useEffect(() => {
    if (isAuthenticated && user) {
      router.replace(signedInPath(user, redirect));
    }
  }, [isAuthenticated, user, redirect, router]);

  if (isAuthenticated) {
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
