'use client';

import { useEffect } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useGetIdentityQuery } from '../store/authApi';

/**
 * Hook to validate authentication state on app load
 * Checks whether a session exists using the optional identity endpoint.
 * - signed out: the slice records a completed unauthenticated session; AuthGuard redirects
 * - 403: Redirects to forbidden page (valid session, insufficient permissions)
 *
 * @returns Loading state while validating
 *
 * @example
 * function App() {
 *   const isValidating = useAuthValidation();
 *
 *   if (isValidating) {
 *     return <LoadingSpinner />;
 *   }
 *
 *   return <YourApp />;
 * }
 */
export function useAuthValidation() {
  const router = useRouter();

  // Always check the optional identity on mount. Signed-out is a successful read.
  const { isLoading, isError, error } = useGetIdentityQuery(undefined, {
    refetchOnMountOrArgChange: true, // Always validate on mount
  });

  useEffect(() => {
    if (isError) {
      const statusCode = (error as { status?: number })?.status;

      if (statusCode === 403) {
        router.push('/403');
      }
    }
  }, [isError, error, router]);

  // Return loading state while validating
  return isLoading;
}
