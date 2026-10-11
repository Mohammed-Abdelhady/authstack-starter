'use client';

import { useCallback, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { parseApiError } from '@app/core';
import { Button } from '@/components/ui/button';
import { HTTP_STATUS } from '@/constants/httpStatus';
import { useLogoutMutation } from '@/modules/auth/store/authApi';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { logout as logoutAction, selectIsAuthenticated } from '@/modules/auth/store/authSlice';
import { toast } from '@/lib/toast';
import { getPathname } from '@/i18n/navigation';
import { useSingleFlight } from '@/hooks/useSingleFlight';
import { SignOutNotConfirmedDialog } from './SignOutNotConfirmedDialog';

/** A server that no longer knows the session has nothing left to sign out. */
function sessionIsAlreadyClosed(error: unknown): boolean {
  return parseApiError(error).statusCode === HTTP_STATUS.UNAUTHORIZED;
}

/**
 * Signs the person out, and leaves the page only once the server has said the
 * session is closed. A request that was lost or failed leaves the session's
 * fate unknown, so the page stays, says so and offers to try again.
 */
export function LogoutButton() {
  const t = useTranslations('auth.activate');
  const tToast = useTranslations('toast');
  const locale = useLocale();
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const [logout, { isLoading: isLoggingOut }] = useLogoutMutation();
  const [failedTries, setFailedTries] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const signOut = useCallback(async () => {
    try {
      await logout().unwrap();
    } catch (error) {
      if (!sessionIsAlreadyClosed(error)) {
        setFailedTries((tries) => tries + 1);
        return;
      }
    }
    dispatch(logoutAction());
    toast.success(tToast('success.logoutSuccess'));
    // Force full page refresh to clear all cached data
    window.location.href = getPathname({ href: '/auth/login', locale });
  }, [logout, dispatch, tToast, locale]);
  const handleLogout = useSingleFlight(signOut);
  const closeNotice = useCallback(() => setFailedTries(0), []);

  // Don't render if not authenticated
  if (!isAuthenticated) {
    return null;
  }

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleLogout}
        busy={isLoggingOut}
        className="flex items-center gap-2"
        data-testid="logout-button"
        aria-label={t('logout')}
        aria-busy={isLoggingOut}
      >
        <LogOut className="w-4 h-4" aria-hidden="true" />
        <span className="hidden sm:inline">{isLoggingOut ? t('loggingOut') : t('logout')}</span>
      </Button>
      <SignOutNotConfirmedDialog
        failedTries={failedTries}
        isRetrying={isLoggingOut}
        onRetry={handleLogout}
        onClose={closeNotice}
        returnFocusTo={buttonRef}
      />
    </>
  );
}
