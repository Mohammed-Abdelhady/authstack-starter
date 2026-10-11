'use client';

import { useCallback, useState } from 'react';
import { useFeatureDisabledHandler } from '@/modules/auth/hooks/useFeatureDisabled';
import { useRefusalText } from '@/hooks/useRefusalText';
import { showsOwnRefusal } from '@/lib/refusal';
import { useConfirmTwoFactorMutation, useSetupTwoFactorMutation } from '../api';
import { SETUP_STEP, type SetupStep, type TwoFactorSetup } from '../types';
import { useSingleFlight } from '@/hooks/useSingleFlight';

export interface TwoFactorSetupFlow {
  step: SetupStep;
  setup: TwoFactorSetup | null;
  recoveryCodes: string[];
  /** Translated message for the step that failed, or null. */
  error: string | null;
  isBusy: boolean;
  start: (password?: string) => Promise<void>;
  goToConfirm: () => void;
  goToScan: () => void;
  confirm: (code: string) => Promise<void>;
  reset: () => void;
}

/**
 * Drives the four steps of turning the second factor on: prove who you are,
 * scan the secret, confirm a first code, keep the recovery codes.
 */
export function useTwoFactorSetup(): TwoFactorSetupFlow {
  const refusalText = useRefusalText();
  const handleFeatureDisabled = useFeatureDisabledHandler();
  const [startSetup, { isLoading: isStarting }] = useSetupTwoFactorMutation();
  const [confirmSetup, { isLoading: isConfirming }] = useConfirmTwoFactorMutation();

  const [step, setStep] = useState<SetupStep>(SETUP_STEP.REAUTH);
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const startOnce = useCallback(
    async (password?: string) => {
      setError(null);
      try {
        setSetup(await showsOwnRefusal(startSetup({ password })).unwrap());
        setStep(SETUP_STEP.SCAN);
      } catch (err) {
        // The card unmounts with its dialogs once the refetch lands.
        if (handleFeatureDisabled(err)) {
          return;
        }
        setError(refusalText(err));
      }
    },
    [handleFeatureDisabled, refusalText, startSetup],
  );
  const guardedStart = useSingleFlight(startOnce);
  const start = useCallback(
    async (password?: string) => {
      await guardedStart(password);
    },
    [guardedStart],
  );

  const confirmOnce = useCallback(
    async (code: string) => {
      setError(null);
      try {
        const result = await showsOwnRefusal(confirmSetup({ code })).unwrap();
        setRecoveryCodes(result.recoveryCodes);
        setStep(SETUP_STEP.RECOVERY_CODES);
      } catch (err) {
        if (handleFeatureDisabled(err)) {
          return;
        }
        setError(refusalText(err));
      }
    },
    [confirmSetup, handleFeatureDisabled, refusalText],
  );
  const guardedConfirm = useSingleFlight(confirmOnce);
  const confirm = useCallback(
    async (code: string) => {
      await guardedConfirm(code);
    },
    [guardedConfirm],
  );

  const reset = useCallback(() => {
    setStep(SETUP_STEP.REAUTH);
    setSetup(null);
    setRecoveryCodes([]);
    setError(null);
  }, []);

  return {
    step,
    setup,
    recoveryCodes,
    error,
    isBusy: isStarting || isConfirming,
    start,
    goToConfirm: useCallback(() => {
      setError(null);
      setStep(SETUP_STEP.CONFIRM);
    }, []),
    goToScan: useCallback(() => {
      setError(null);
      setStep(SETUP_STEP.SCAN);
    }, []),
    confirm,
    reset,
  };
}
