'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/navigation';
import { LoadingRegion } from '@/components/layout/LoadingRegion';
import { Button } from '@/components/ui/button';
import { useAppSelector } from '@/store/hooks';
import {
  selectIsAuthenticated,
  selectValidationErrorStatus,
  selectValidationStatus,
} from '@/modules/auth/store/authSlice';
import { useGetIdentityQuery } from '@/modules/auth/store/authApi';

interface AuthGuardProps {
  readonly children: React.ReactNode;
}

/**
 * AuthGuard component to protect routes requiring authentication
 * Redirects unauthenticated users to login page with return URL
 * Relies on AuthProvider for global session validation
 *
 * @example
 * // In a protected page
 * export default function DashboardPage() {
 *   return (
 *     <AuthGuard>
 *       <Dashboard />
 *     </AuthGuard>
 *   );
 * }
 */
export function AuthGuard({ children }: Readonly<AuthGuardProps>) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const validationStatus = useAppSelector(selectValidationStatus);
  const validationErrorStatus = useAppSelector(selectValidationErrorStatus);
  const { refetch } = useGetIdentityQuery();

  const waiting = validationStatus === 'idle' || validationStatus === 'pending';
  const unavailable = validationStatus === 'failed' && validationErrorStatus !== 401;

  useEffect(() => {
    if (waiting || unavailable) {
      return;
    }

    if (!isAuthenticated) {
      const returnUrl = encodeURIComponent(pathname);
      router.push(`/auth/login?redirect=${returnUrl}`);
    }
  }, [isAuthenticated, waiting, unavailable, pathname, router]);

  if (waiting) {
    return <LoadingRegion label={t('common.loading')} testId="auth-guard-loading" />;
  }

  if (unavailable) {
    return (
      <div
        className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-4 p-6"
        data-testid="auth-guard-retry"
      >
        <p className="text-center text-muted-foreground">{t('auth.sessionCheckFailed')}</p>
        <Button type="button" onClick={() => void refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoadingRegion label={t('common.loading')} testId="auth-guard-loading" />;
  }

  return <>{children}</>;
}
