'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { REDIRECT_PARAM } from '@/modules/auth/constants/authMethods';
import { signedInPath } from '@/modules/auth/utils/signInRouting';
import { isNativeBrowserGuestJourney } from '@/modules/auth/utils/nativeBrowserJourney';
import { readNativeBrowserGuestFlow } from '@/modules/auth/utils/nativeBrowserSelectors';
import { NATIVE_BROWSER_FLOW } from '@/modules/auth/constants/nativeBrowserSelectors';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { LoadingRegion } from '@/components/layout/LoadingRegion';
import { useAppSelector } from '@/store/hooks';
import {
  selectIsAuthenticated,
  selectUser,
  selectAuthLoading,
} from '@/modules/auth/store/authSlice';

interface ActivationGuardProps {
  readonly children: React.ReactNode;
}

/**
 * ActivationGuard component to protect activation route
 * Sends an already signed-in user through the normal continuation
 * Allows unauthenticated users to proceed with activation
 * Relies on AuthProvider for global session validation
 *
 * @example
 * // In activation page
 * export default function ActivatePage() {
 *   return (
 *     <ActivationGuard>
 *       <ActivationForm />
 *     </ActivationGuard>
 *   );
 * }
 */
export function ActivationGuard({ children }: Readonly<ActivationGuardProps>) {
  const t = useTranslations('common');
  const router = useRouter();
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const user = useAppSelector(selectUser);
  const isAuthLoading = useAppSelector(selectAuthLoading);
  const searchParams = useSearchParams();
  const redirect = searchParams.get(REDIRECT_PARAM);
  const explicitJourney = isNativeBrowserGuestJourney(
    redirect,
    readNativeBrowserGuestFlow(searchParams),
    NATIVE_BROWSER_FLOW.REGISTRATION,
  );

  useEffect(() => {
    if (isAuthenticated && user && !explicitJourney) router.replace(signedInPath(user, redirect));
  }, [explicitJourney, isAuthenticated, user, redirect, router]);

  if (isAuthLoading) {
    return <LoadingRegion label={t('loading')} testId="activation-guard-loading" />;
  }

  if (isAuthenticated && user && !explicitJourney) return null;

  // User is not authenticated, render activation form
  return <>{children}</>;
}
