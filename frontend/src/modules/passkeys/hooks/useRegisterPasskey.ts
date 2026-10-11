'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFeatureDisabledHandler } from '@/modules/auth/hooks/useFeatureDisabled';
import { translatableErrorCode } from '@/modules/auth/utils/errorCodeMessage';
import { useCreatePasskeyOptionsMutation, useRegisterPasskeyMutation } from '../api';
import type { PasskeySummary } from '../types';
import { currentDeviceLabelKey } from '../utils/deviceLabel';
import { createPasskey, webAuthnMessageKey } from '../utils/webauthn';
import { useSingleFlight } from '@/hooks/useSingleFlight';

export interface RegisterPasskeyState {
  /** Runs the ceremony and stores the credential. Null when it did not finish. */
  register: () => Promise<PasskeySummary | null>;
  isBusy: boolean;
  /** Translated, or null while nothing has gone wrong. */
  error: string | null;
}

/**
 * Adds a passkey to the signed-in account.
 *
 * The credential is stored as soon as the browser hands it over, under a name
 * taken from the device. Asking for a better name first would leave the
 * authenticator holding a passkey the server never heard of if the reader
 * closed the dialog, so naming is a rename afterwards.
 */
export function useRegisterPasskey(): RegisterPasskeyState {
  const t = useTranslations('auth.passkeys');
  const tDevices = useTranslations('settings.passkeys.deviceNames');
  const tCodes = useTranslations('errors.codes');
  const [createOptions] = useCreatePasskeyOptionsMutation();
  const [storePasskey] = useRegisterPasskeyMutation();
  const handleFeatureDisabled = useFeatureDisabledHandler();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCeremony = useCallback(async () => {
    setError(null);
    setIsBusy(true);

    try {
      const options = await createOptions().unwrap();
      const ceremony = await createPasskey(options);

      if (!ceremony.ok) {
        setError(t(webAuthnMessageKey(ceremony.errorKey)));
        return null;
      }

      return await storePasskey({
        response: ceremony.value,
        name: tDevices(currentDeviceLabelKey()),
      }).unwrap();
    } catch (err) {
      if (handleFeatureDisabled(err)) {
        return null;
      }
      setError(tCodes(translatableErrorCode(err)));
      return null;
    } finally {
      setIsBusy(false);
    }
  }, [createOptions, handleFeatureDisabled, storePasskey, t, tCodes, tDevices]);

  // Held through the browser prompt, so a second click cannot open another.
  const guarded = useSingleFlight(runCeremony);
  const register = useCallback(async () => (await guarded()) ?? null, [guarded]);

  return { register, isBusy, error };
}
