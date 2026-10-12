'use client';

import { useCallback } from 'react';
import { useStore } from 'react-redux';
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { ErrorCode } from '@app/core';
import { HTTP_STATUS } from '@/constants/httpStatus';
import { useRouter } from '@/i18n/navigation';
import { useAppDispatch } from '@/store/hooks';
import type { RootState } from '@/store/store';
import { authApi } from '../store/authApi';
import { loginFulfilled } from '../store/authSlice';
import type { SignedInUser } from '../types/auth.types';
import { signedInPath, twoFactorPath } from '../utils/signInRouting';

export interface SignInOutcome {
  requiresTwoFactor: boolean;
  user: SignedInUser | null;
}

/** Finishes a sign-in the same way for the password, link and code flows. */
export type CompleteSignIn = (outcome: SignInOutcome, redirect?: string | null) => Promise<void>;

function sessionRequiredError(): FetchBaseQueryError {
  return {
    status: HTTP_STATUS.UNAUTHORIZED,
    data: {
      success: false,
      error: { code: ErrorCode.SESSION_REQUIRED, message: ErrorCode.SESSION_REQUIRED },
    },
  };
}

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
  const store = useStore<RootState>();

  return useCallback(
    async (outcome: SignInOutcome, redirect?: string | null) => {
      if (outcome.requiresTwoFactor) {
        router.push(twoFactorPath(redirect));
        return;
      }

      let user = outcome.user;
      if (user) {
        dispatch(loginFulfilled(user));
      } else {
        const identity = await dispatch(
          authApi.endpoints.getIdentity.initiate(undefined, { forceRefetch: true }),
        ).unwrap();
        if (!identity.authenticated) {
          throw sessionRequiredError();
        }
        const currentAuth = store.getState().auth;
        const currentUser = currentAuth.user;
        if (
          !currentAuth.isAuthenticated ||
          currentAuth.validationStatus !== 'succeeded' ||
          currentUser?.id !== identity.user.id
        ) {
          throw sessionRequiredError();
        }
        user = currentUser;
      }

      router.replace(signedInPath(user, redirect));
    },
    [dispatch, router, store],
  );
}
