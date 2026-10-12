'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ErrorCode, parseApiError } from '@app/core';
import { useFeatureDisabledHandler } from '@/modules/auth/hooks/useFeatureDisabled';
import { translatableErrorCode } from '@/modules/auth/utils/errorCodeMessage';
import { useCreatePasskeyOptionsMutation, useRegisterPasskeyMutation } from '../api';
import type {
  PasskeyRegistrationProof,
  PasskeyRegistrationRequirement,
  PasskeySummary,
} from '../types';
import { currentDeviceLabelKey } from '../utils/deviceLabel';
import { createPasskey, webAuthnMessageKey } from '../utils/webauthn';
import { useSingleFlight } from '@/hooks/useSingleFlight';
// feature:totp:start
import { twoFactorLockSeconds } from '@/modules/auth/utils/twoFactorLock';
// feature:totp:end
import { useCooldown } from '@/modules/auth/hooks/useCooldown';

export interface RegisterPasskeyState {
  /** Runs the ceremony and stores the credential. Null when it did not finish. */
  register: (proof?: PasskeyRegistrationProof) => Promise<PasskeySummary | null>;
  isBusy: boolean;
  /** Translated, or null while nothing has gone wrong. */
  error: string | null;
  requiredProof: PasskeyRegistrationRequirement | null;
  isCooling: boolean;
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
  const tRegistration = useTranslations('settings.passkeys.registration');
  const tDevices = useTranslations('settings.passkeys.deviceNames');
  const tCodes = useTranslations('errors.codes');
  const [createOptions] = useCreatePasskeyOptionsMutation();
  const [storePasskey] = useRegisterPasskeyMutation();
  const handleFeatureDisabled = useFeatureDisabledHandler();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiredProof, setRequiredProof] = useState<PasskeyRegistrationRequirement | null>(null);
  const {
    isCooling,
    secondsLeft,
    // feature:totp:start
    start: startCooldown,
    // feature:totp:end
  } = useCooldown(0);

  const runCeremony = useCallback(
    async (proof: PasskeyRegistrationProof = {}) => {
      if (isCooling) return null;
      setError(null);
      setIsBusy(true);

      try {
        const options = await createOptions(proof).unwrap();
        const ceremony = await createPasskey(options);

        if (!ceremony.ok) {
          setError(t(webAuthnMessageKey(ceremony.errorKey)));
          return null;
        }

        const created = await storePasskey({
          response: ceremony.value,
          name: tDevices(currentDeviceLabelKey()),
        }).unwrap();
        setRequiredProof(null);
        return created;
      } catch (err) {
        if (handleFeatureDisabled(err)) {
          return null;
        }
        const code = translatableErrorCode(err);
        if (code === ErrorCode.REAUTH_REQUIRED) {
          const requirement = parseApiError(err).details?.required;
          if (
            requirement === 'password' ||
            requirement === 'recent_sign_in' ||
            requirement === 'second_factor'
          ) {
            setRequiredProof(requirement);
            return null;
          }
        }
        // feature:totp:start
        const retryAfter = twoFactorLockSeconds(err);
        if (retryAfter !== null) {
          startCooldown(retryAfter);
          return null;
        }
        if (code === ErrorCode.TWO_FACTOR_LOCKED) {
          setError(tRegistration('locked'));
          return null;
        }
        // feature:totp:end
        setError(tCodes(code));
        return null;
      } finally {
        setIsBusy(false);
      }
    },
    [
      createOptions,
      handleFeatureDisabled,
      isCooling,
      startCooldown, // feature:totp
      storePasskey,
      t,
      tCodes,
      tDevices,
      tRegistration, // feature:totp
    ],
  );

  // Held through the browser prompt, so a second click cannot open another.
  const guarded = useSingleFlight(runCeremony);
  const register = useCallback(
    async (proof?: PasskeyRegistrationProof) => {
      if (requiredProof === 'recent_sign_in') setRequiredProof(null);
      return (await guarded(proof)) ?? null;
    },
    [guarded, requiredProof],
  );

  const shownError = isCooling
    ? tRegistration('lockedCountdown', { seconds: secondsLeft })
    : error !== null
      ? error
      : requiredProof === 'password'
        ? tRegistration('passwordRequired')
        : requiredProof === 'second_factor'
          ? tRegistration('secondFactorRequired')
          : requiredProof === 'recent_sign_in'
            ? tRegistration('recentSignInRequired')
            : null;

  return { register, isBusy, error: shownError, requiredProof, isCooling };
}
