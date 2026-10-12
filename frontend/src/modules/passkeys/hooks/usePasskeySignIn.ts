'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCompleteSignIn } from '@/modules/auth/hooks/useCompleteSignIn';
import { useFeatureDisabledHandler } from '@/modules/auth/hooks/useFeatureDisabled';
import type { LoginResponse } from '@/modules/auth/types/auth.types';
import { translatableErrorCode } from '@/modules/auth/utils/errorCodeMessage';
import { useCreatePasskeyLoginOptionsMutation } from '../api';
import {
  assertPasskey,
  webAuthnMessageKey,
  type AuthenticationResponseJSON,
} from '../utils/webauthn';
import { useSingleFlight } from '@/hooks/useSingleFlight';

/** The call that turns a signed challenge into a session, or a second one. */
export type PasskeyVerify = (response: AuthenticationResponseJSON) => Promise<LoginResponse>;

export interface PasskeySignInState {
  /** Runs the ceremony and finishes the sign-in. */
  run: () => Promise<void>;
  isBusy: boolean;
  /** Translated, or null while nothing has gone wrong. */
  error: string | null;
}

/**
 * A sign-in that a passkey answers, in three steps: options from the backend,
 * the browser prompt, then verify.
 *
 * Which verify runs is the caller's business, because the same three steps
 * sign in from the login page and answer a held challenge on the two-factor
 * page. Both end in `useCompleteSignIn`, so a passkey that only proved
 * possession still lands on the code page.
 */
export function usePasskeySignIn(
  verify: PasskeyVerify,
  redirect: string | null,
): PasskeySignInState {
  const t = useTranslations('auth.passkeys');
  const tCodes = useTranslations('errors.codes');
  const [createLoginOptions] = useCreatePasskeyLoginOptionsMutation();
  const completeSignIn = useCompleteSignIn();
  const handleFeatureDisabled = useFeatureDisabledHandler();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCeremony = useCallback(async () => {
    setError(null);
    setIsBusy(true);

    try {
      const options = await createLoginOptions().unwrap();
      const ceremony = await assertPasskey(options);

      if (!ceremony.ok) {
        setError(t(webAuthnMessageKey(ceremony.errorKey)));
        return;
      }

      await completeSignIn(await verify(ceremony.value), redirect);
    } catch (err) {
      // The gate takes the button off the page once the refetch lands.
      if (handleFeatureDisabled(err)) {
        return;
      }
      setError(tCodes(translatableErrorCode(err)));
    } finally {
      setIsBusy(false);
    }
  }, [completeSignIn, createLoginOptions, handleFeatureDisabled, redirect, t, tCodes, verify]);

  // Held through the browser prompt, so a second click cannot open another.
  const guarded = useSingleFlight(runCeremony);
  const run = useCallback(async () => {
    await guarded();
  }, [guarded]);

  return { run, isBusy, error };
}
