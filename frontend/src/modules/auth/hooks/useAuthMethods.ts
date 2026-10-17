'use client';

import { useCallback, useMemo, useState } from 'react';
import { useGetAuthMethodsQuery } from '../api/authMethodsApi';
import type { AuthMethods } from '@app/sdk';

/** What a screen knows about the sign-in methods before it renders. */
export interface AuthMethodsState {
  methods: AuthMethods | undefined;
  audiencesEnabled?: boolean | undefined;
  isLoading: boolean;
  /** True when the read failed. `methods` is then a stand-in, not an answer. */
  isError: boolean;
  /** True once the answer is in and every method is off. */
  hasNoMethods: boolean;
  /** Asks again after a failed read. */
  retry: () => void;
  /** True once this screen has asked again, so its retry control can take the focus back. */
  hasRetried: boolean;
}

const NOTHING_ENABLED: AuthMethods = {
  password: false,
  magicLink: false,
  emailCode: false,
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
export function useAuthMethods(options: { skip?: boolean } = {}): AuthMethodsState {
  const { data, isLoading, isError, refetch } = useGetAuthMethodsQuery(undefined, options);
  const discovery = useMemo(() => {
    if (!data) return undefined;
    const { audiencesEnabled, ...methods } = data;
    return { audiencesEnabled, methods };
  }, [data]);
  const methods = isError ? NOTHING_ENABLED : discovery?.methods;
  // The retry control leaves the page while the read runs again. Kept here,
  // the fact outlives that, and belongs to the one screen that asked.
  const [hasRetried, setHasRetried] = useState(false);
  const retry = useCallback(() => {
    setHasRetried(true);
    void refetch();
  }, [refetch]);

  return {
    methods,
    audiencesEnabled:
      isError || isLoading || options.skip === true ? undefined : discovery?.audiencesEnabled,
    isLoading,
    isError,
    hasNoMethods: !isLoading && !isError && methods !== undefined && !countsAsEnabled(methods),
    retry,
    hasRetried,
  };
}
