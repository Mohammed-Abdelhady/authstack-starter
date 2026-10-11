'use client';

import { useGetAuthMethodsQuery } from '../api/authMethodsApi';
import type { AuthMethods } from '@app/sdk';

/** What a screen knows about the sign-in methods before it renders. */
export interface AuthMethodsState {
  methods: AuthMethods | undefined;
  isLoading: boolean;
  /** True when the read failed. `methods` is then a stand-in, not an answer. */
  isError: boolean;
  /** True once the answer is in and every method is off. */
  hasNoMethods: boolean;
  /** Asks again after a failed read. */
  retry: () => void;
}

const NOTHING_ENABLED: AuthMethods = {
  password: false,
  magicLink: false,
  twoFactor: false,
  passkeys: false,
  oauth: [],
};

function countsAsEnabled(methods: AuthMethods): boolean {
  return methods.password || methods.magicLink || methods.passkeys || methods.oauth.length > 0;
}

/**
 * Reads the enabled sign-in methods. A failed request falls back to nothing
 * enabled, so no form appears that cannot work. That fallback is not the
 * server saying every method is off: a screen that would tell the person so
 * checks `isError` first and offers `retry`.
 */
export function useAuthMethods(): AuthMethodsState {
  const { data, isLoading, isError, refetch } = useGetAuthMethodsQuery();
  const methods = isError ? NOTHING_ENABLED : data;

  return {
    methods,
    isLoading,
    isError,
    hasNoMethods: !isLoading && !isError && methods !== undefined && !countsAsEnabled(methods),
    retry: refetch,
  };
}
