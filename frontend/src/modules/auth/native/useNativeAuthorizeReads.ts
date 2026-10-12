'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Identity } from '@app/sdk';
import { useGetIdentityQuery, useGetNativeAuthorizeTransactionQuery } from '../store/authApi';
import type { NativeAuthorizeTransaction } from '../types/nativeAuthorize.types';

export interface NativeAuthorizeReads {
  account: Identity['user'] | undefined;
  accountSignedOut: boolean;
  transactionData: NativeAuthorizeTransaction | undefined;
  isTransactionLoading: boolean;
  /** Failures answered during this visit; `undefined` while there is none. */
  accountError: unknown;
  transactionError: unknown;
  /** Reads the signed-in account from the server, bypassing the cache. */
  readAccount: () => Promise<Identity>;
  refetchAll: () => void;
}

/**
 * The two reads behind the consent card: who is signed in, and what is asked.
 *
 * A request that was cached or already on the wire when this visit began may
 * describe an earlier session, so its failure is ignored and read again.
 * `paused` stops both reads once the page has sent the person to sign-in.
 */
export function useNativeAuthorizeReads(
  transaction: string,
  paused: boolean,
): NativeAuthorizeReads {
  const hasTransaction = transaction.length > 0;
  const accountQuery = useGetIdentityQuery(undefined, {
    skip: paused,
    refetchOnMountOrArgChange: true,
  });
  const transactionQuery = useGetNativeAuthorizeTransactionQuery(transaction, {
    skip: paused || !hasTransaction,
  });

  const [inherited] = useState(() => ({
    account: accountQuery.requestId,
    transaction: transactionQuery.requestId,
  }));

  const accountInherited = accountQuery.requestId === inherited.account;
  const transactionInherited = transactionQuery.requestId === inherited.transaction;
  const accountFailed = accountQuery.isError && !accountInherited;
  const transactionFailed = transactionQuery.isError && !transactionInherited;

  const { refetch: refetchAccount } = accountQuery;
  const { refetch: refetchTransaction } = transactionQuery;

  // An inherited request that fails after mount is not refetched by the query
  // hook, so ask again here. A cached failure is already being refetched and
  // the second call joins that request.
  const accountStale =
    !paused && accountInherited && (accountQuery.isSuccess || accountQuery.isError);
  const transactionStale =
    !paused && hasTransaction && transactionQuery.isError && transactionInherited;
  useEffect(() => {
    if (accountStale) {
      void refetchAccount();
    }
  }, [accountStale, refetchAccount]);
  useEffect(() => {
    if (transactionStale) {
      void refetchTransaction();
    }
  }, [refetchTransaction, transactionStale]);

  const readAccount = useCallback(() => refetchAccount().unwrap(), [refetchAccount]);

  const refetchAll = useCallback(() => {
    void refetchAccount();
    if (hasTransaction) {
      void refetchTransaction();
    }
  }, [hasTransaction, refetchAccount, refetchTransaction]);

  return {
    account:
      !accountQuery.isError && accountQuery.data?.authenticated
        ? accountQuery.data.user
        : undefined,
    accountSignedOut:
      !accountQuery.isFetching &&
      !accountQuery.isError &&
      !accountInherited &&
      accountQuery.data?.authenticated === false,
    transactionData: transactionQuery.data,
    isTransactionLoading: transactionQuery.isLoading,
    accountError: accountFailed ? accountQuery.error : undefined,
    transactionError: transactionFailed ? transactionQuery.error : undefined,
    readAccount,
    refetchAll,
  };
}
