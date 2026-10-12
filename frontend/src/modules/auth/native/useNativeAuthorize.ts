'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ErrorCode, parseApiError } from '@app/core';
import { useRouter } from '@/i18n/navigation';
import { baseApi } from '@/store/api/baseApi';
import { useAppDispatch } from '@/store/hooks';
import { REDIRECT_PARAM } from '../constants/authMethods';
import { isSignInRequired, nativeAuthorizeContinuation } from '../constants/nativeAuthorize';
import { translatableErrorCode } from '../utils/errorCodeMessage';
import {
  useApproveNativeAuthorizeMutation,
  useDenyNativeAuthorizeMutation,
  useLogoutMutation,
} from '../store/authApi';
import { logout as logoutAction } from '../store/authSlice';
import { isSafeNativeRedirect } from './nativeRedirect';
import { useNativeAuthorizeReads } from './useNativeAuthorizeReads';

/** How long the page waits for the app to open before offering a second try. */
const REOPEN_DELAY_MS = 2000;

/** Which control is running, so each one can show its own progress. */
export type NativeAuthorizeAction = 'approve' | 'deny' | 'notYou';

export type NativeAuthorizeViewKind =
  'loading' | 'ready' | 'returning' | 'expired' | 'disabled' | 'error';

export interface NativeAuthorizeFailure {
  code: string;
  message: string;
  /** The answer means there is no usable session, so the person must sign in. */
  signInRequired: boolean;
}

export interface NativeAuthorizeView {
  kind: NativeAuthorizeViewKind;
  applicationName: string;
  accountName: string;
  accountEmail: string;
  action: NativeAuthorizeAction | null;
  failure: NativeAuthorizeFailure | null;
  /** The signed-in account is not the one the card showed a moment ago. */
  accountChanged: boolean;
  canReopen: boolean;
}

export interface NativeAuthorizeController {
  view: NativeAuthorizeView;
  approve: () => void;
  deny: () => void;
  notYou: () => void;
  retry: () => void;
  reopen: () => void;
}

/** Where a signed-out visitor goes, with the way back carried along. */
function signInHref(transaction: string): string {
  const continuation = nativeAuthorizeContinuation(transaction);
  return `/auth/login?${REDIRECT_PARAM}=${encodeURIComponent(continuation)}`;
}

const EMPTY_VIEW: Omit<NativeAuthorizeView, 'kind'> = {
  applicationName: '',
  accountName: '',
  accountEmail: '',
  action: null,
  failure: null,
  accountChanged: false,
  canReopen: false,
};

/**
 * The browser step of native sign-in, as state plus handlers.
 *
 * It waits for the account as well as the transaction, so approval is never
 * offered before the person can see which account is granting it. Approve and
 * deny name that account, and neither completes for a different one. A single
 * in-flight guard covers approve, deny and "Not you?", so no two requests can
 * race and a held Enter spends the transaction once.
 */
export function useNativeAuthorize(transaction: string): NativeAuthorizeController {
  const t = useTranslations('auth.nativeAuthorize');
  const tCodes = useTranslations('errors.codes');
  const router = useRouter();
  const dispatch = useAppDispatch();

  const [leaving, setLeaving] = useState(false);
  const {
    account,
    accountSignedOut,
    transactionData,
    isTransactionLoading,
    accountError,
    transactionError,
    readAccount,
    refetchAll,
  } = useNativeAuthorizeReads(transaction, leaving);
  const [approve] = useApproveNativeAuthorizeMutation();
  const [deny] = useDenyNativeAuthorizeMutation();
  const [logout] = useLogoutMutation();

  const [action, setAction] = useState<NativeAuthorizeAction | null>(null);
  const [actionFailure, setActionFailure] = useState<NativeAuthorizeFailure | null>(null);
  const [accountChanged, setAccountChanged] = useState(false);
  const [redirectUri, setRedirectUri] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [canReopen, setCanReopen] = useState(false);

  const inFlight = useRef(false);
  const hasLeft = useRef(false);

  const toFailure = useCallback(
    (error: unknown): NativeAuthorizeFailure => {
      const code = translatableErrorCode(error, ErrorCode.INTERNAL_ERROR);
      const answer = parseApiError(error);
      return {
        code,
        message: tCodes(code),
        signInRequired: isSignInRequired(answer.code, answer.statusCode),
      };
    },
    [tCodes],
  );

  const transactionFailure = transactionError === undefined ? null : toFailure(transactionError);
  const accountFailure = accountError === undefined ? null : toFailure(accountError);
  const failure = actionFailure ?? transactionFailure ?? accountFailure;
  // A refused session outranks whatever else failed beside it.
  const signInRequired =
    accountSignedOut ||
    [actionFailure, transactionFailure, accountFailure].some(
      (candidate) => candidate?.signInRequired === true,
    );

  // A refused session and "Not you?" both end here. Flagging it during render
  // stops the reads before anything below can ask the server again.
  if (signInRequired && !leaving) {
    setLeaving(true);
  }

  // Leaving clears the auth slice, or the sign-in page bounces straight back
  // here, and drops every cached read so the return trip starts from the
  // server's answer for whoever signed in.
  useEffect(() => {
    if (!leaving || hasLeft.current) {
      return;
    }
    hasLeft.current = true;
    dispatch(logoutAction());
    dispatch(baseApi.util.resetApiState());
    router.replace(signInHref(transaction));
  }, [dispatch, leaving, router, transaction]);

  useEffect(() => {
    if (!returning) {
      return;
    }
    const timer = setTimeout(() => setCanReopen(true), REOPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [returning]);

  const failAction = useCallback(
    (error: unknown) => {
      inFlight.current = false;
      setAction(null);
      setActionFailure(toFailure(error));
    },
    [toFailure],
  );

  /** Back to the card, now showing whoever is signed in, with the notice. */
  const showChangedAccount = useCallback(() => {
    inFlight.current = false;
    setAction(null);
    setAccountChanged(true);
  }, []);

  const runAction = useCallback(
    async (kind: 'approve' | 'deny') => {
      if (inFlight.current || !account) {
        return;
      }
      inFlight.current = true;
      setActionFailure(null);
      setAccountChanged(false);
      setAction(kind);
      const shownUserId = account.id;
      try {
        // Another tab may have changed the session since the card was drawn.
        if (kind === 'approve') {
          const identity = await readAccount();
          if (!identity.authenticated) {
            setLeaving(true);
            return;
          }
          if (identity.user.id !== shownUserId) {
            showChangedAccount();
            return;
          }
        }
        const call = kind === 'approve' ? approve : deny;
        const result = await call({
          transactionId: transaction,
          expectedUserId: shownUserId,
        }).unwrap();
        if (!isSafeNativeRedirect(result.redirectUri)) {
          inFlight.current = false;
          setAction(null);
          setActionFailure({
            code: ErrorCode.INTERNAL_ERROR,
            message: t('errorGeneric'),
            signInRequired: false,
          });
          return;
        }
        setRedirectUri(result.redirectUri);
        setAction(null);
        setCanReopen(false);
        setReturning(true);
        window.location.assign(result.redirectUri);
      } catch (error) {
        if (translatableErrorCode(error) !== ErrorCode.NATIVE_AUTHORIZE_ACCOUNT_MISMATCH) {
          failAction(error);
          return;
        }
        try {
          const identity = await readAccount();
          if (!identity.authenticated) {
            setLeaving(true);
            return;
          }
          showChangedAccount();
        } catch (readError) {
          failAction(readError);
        }
      }
    },
    [account, approve, deny, failAction, readAccount, showChangedAccount, t, transaction],
  );

  const notYou = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setActionFailure(null);
    setAction('notYou');
    try {
      await logout().unwrap();
      setLeaving(true);
    } catch (error) {
      failAction(error);
    }
  }, [failAction, logout]);

  const retry = useCallback(() => {
    inFlight.current = false;
    setActionFailure(null);
    setAction(null);
    setAccountChanged(false);
    setReturning(false);
    setCanReopen(false);
    refetchAll();
  }, [refetchAll]);

  const reopen = useCallback(() => {
    if (redirectUri) {
      window.location.assign(redirectUri);
    }
  }, [redirectUri]);

  const approveAction = useCallback(() => {
    void runAction('approve');
  }, [runAction]);
  const denyAction = useCallback(() => {
    void runAction('deny');
  }, [runAction]);

  const view: NativeAuthorizeView = (() => {
    const base = {
      ...EMPTY_VIEW,
      applicationName: transactionData?.applicationName ?? '',
      accountName: account?.name ?? '',
      accountEmail: account?.email ?? '',
      action,
      failure,
      accountChanged,
      canReopen,
    };

    if (transaction.length === 0 || failure?.code === ErrorCode.NATIVE_TRANSACTION_EXPIRED) {
      return { ...base, kind: 'expired' };
    }
    if (leaving) {
      return { ...base, kind: 'loading' };
    }
    if (failure?.code === ErrorCode.NATIVE_AUTH_DISABLED) {
      return { ...base, kind: 'disabled' };
    }
    if (failure) {
      return { ...base, kind: 'error' };
    }
    if (returning) {
      return { ...base, kind: 'returning' };
    }
    if (!account || isTransactionLoading || !transactionData) {
      return { ...base, kind: 'loading' };
    }
    return { ...base, kind: 'ready' };
  })();

  return { view, approve: approveAction, deny: denyAction, notYou, retry, reopen };
}
