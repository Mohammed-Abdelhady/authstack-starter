'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { REDIRECT_PARAM } from '@/modules/auth/constants/authMethods';
import { NATIVE_BROWSER_FLOW } from '@/modules/auth/constants/nativeBrowserSelectors';
import { isNativeBrowserGuestJourney } from '@/modules/auth/utils/nativeBrowserJourney';
import { readNativeBrowserGuestFlow } from '@/modules/auth/utils/nativeBrowserSelectors';
import { useRouter } from '@/i18n/navigation';
import { useAppSelector } from '@/store/hooks';
import { selectIsAuthenticated } from '@/modules/auth/store/authSlice';
import { AuthLayout } from '@/modules/auth/components/AuthLayout';
import { ForgotPasswordForm } from './ForgotPasswordForm';

/**
 * ForgotPasswordPage component
 * Renders the password reset request form within the auth layout
 * Redirects to dashboard if user is already authenticated
 *
 * @example
 * // In Next.js route
 * export default function ForgotPasswordRoute() {
 *   return <ForgotPasswordPage />;
 * }
 */
export function ForgotPasswordPage() {
  const router = useRouter();
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const searchParams = useSearchParams();
  const explicitJourney = isNativeBrowserGuestJourney(
    searchParams.get(REDIRECT_PARAM),
    readNativeBrowserGuestFlow(searchParams),
    NATIVE_BROWSER_FLOW.RECOVERY,
  );

  useEffect(() => {
    // Redirect to dashboard if already authenticated
    if (isAuthenticated && !explicitJourney) {
      router.push('/dashboard');
    }
  }, [explicitJourney, isAuthenticated, router]);

  // Don't render form if already authenticated
  if (isAuthenticated && !explicitJourney) {
    return null;
  }

  return (
    <AuthLayout>
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
