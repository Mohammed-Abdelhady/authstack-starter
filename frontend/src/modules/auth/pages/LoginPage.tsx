'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import { useAppSelector } from '@/store/hooks';
import { selectIsAuthenticated, selectUser } from '../store/authSlice';
import { signedInPath } from '../utils/signInRouting';
import { REDIRECT_PARAM } from '../constants/authMethods';
import { readNativeBrowserGuestFlow } from '../utils/nativeBrowserSelectors';
import { isNativeBrowserGuestJourney } from '../utils/nativeBrowserJourney';
import { AuthLayout } from '../components/AuthLayout';
import { LoginForm } from '../components/LoginForm';

/**
 * LoginPage component
 * Renders the login form within the auth layout
 * Redirects to dashboard if user is already authenticated
 *
 * @example
 * // In Next.js route
 * export default function LoginRoute() {
 *   return <LoginPage />;
 * }
 */
export function LoginPage() {
  const router = useRouter();
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const user = useAppSelector(selectUser);
  const searchParams = useSearchParams();
  const redirect = searchParams.get(REDIRECT_PARAM);
  const explicitJourney = isNativeBrowserGuestJourney(
    redirect,
    readNativeBrowserGuestFlow(searchParams),
  );

  useEffect(() => {
    if (isAuthenticated && user && !explicitJourney) {
      router.replace(signedInPath(user, redirect));
    }
  }, [explicitJourney, isAuthenticated, user, redirect, router]);

  // Don't render login form if already authenticated
  if (isAuthenticated && !explicitJourney) {
    return null;
  }

  return (
    <AuthLayout>
      <LoginForm />
    </AuthLayout>
  );
}
