'use client';

import { useCallback } from 'react';
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { ErrorCode } from '@app/core';
import { HTTP_STATUS } from '@/constants/httpStatus';
import { useRouter } from '@/i18n/navigation';
import { useAppDispatch } from '@/store/hooks';
import { authApi } from '../store/authApi';
import type { SignedInUser } from '../types/auth.types';
import { signedInPath, twoFactorPath } from '../utils/signInRouting';

export interface SignInOutcome {
  requiresTwoFactor: boolean;
  user: SignedInUser | null;
}

/** Finishes a sign-in the same way for the password, link and code flows. */
export type CompleteSignIn = (outcome: SignInOutcome, redirect?: string | null) => Promise<void>;

/**
 * The last step of every sign-in the client drives.
 *
 * A challenged account goes to the code page with its redirect intact.
 * Otherwise the session cookie is already set. When the reply did not carry
 * the account, identity must confirm the session before the browser moves on.
 */
export function useCompleteSignIn(): CompleteSignIn {
  const router = useRouter();
  const dispatch = useAppDispatch();

  return useCallback(
    async (outcome: SignInOutcome, redirect?: string | null) => {
      if (outcome.requiresTwoFactor) {
        router.push(twoFactorPath(redirect));
        return;
      }

      let user = outcome.user;
      if (!user) {
        const identity = await dispatch(
          authApi.endpoints.getIdentity.initiate(undefined, { forceRefetch: true }),
        ).unwrap();
        if (!identity.authenticated) {
          const refusal: FetchBaseQueryError = {
            status: HTTP_STATUS.UNAUTHORIZED,
            data: {
              success: false,
              error: { code: ErrorCode.SESSION_REQUIRED, message: ErrorCode.SESSION_REQUIRED },
            },
          };
          throw refusal;
        }
        user = identity.user;
      }

      router.replace(signedInPath(user, redirect));
    },
    [dispatch, router],
  );
}
