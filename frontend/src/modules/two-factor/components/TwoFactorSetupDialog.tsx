'use client';

import { useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTwoFactorSetup } from '../hooks/useTwoFactorSetup';
import { SETUP_STEP } from '../types';
import { ConfirmStep } from './steps/ConfirmStep';
import { ReauthStep } from './steps/ReauthStep';
import { RecoveryCodesStep } from './steps/RecoveryCodesStep';
import { ScanStep } from './steps/ScanStep';

interface TwoFactorSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** True when the account signs in with a password and re-enters it here. */
  hasPassword: boolean;
}

/** Turns the second factor on, one step at a time. */
export function TwoFactorSetupDialog({
  open,
  onOpenChange,
  hasPassword,
}: TwoFactorSetupDialogProps) {
  const t = useTranslations('settings.twoFactor.setup');
  const flow = useTwoFactorSetup();
  const { reset } = flow;

  useEffect(() => {
    if (!open) {
      reset();
    }
  }, [open, reset]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  // The recovery codes are readable here and nowhere else, so Escape and a
  // click on the overlay must not take them away. Only Done closes the dialog.
  const onDialogOpenChange = useCallback(
    (next: boolean) => {
      if (!next && flow.step === SETUP_STEP.RECOVERY_CODES) {
        return;
      }
      onOpenChange(next);
    },
    [flow.step, onOpenChange],
  );

  return (
    <Dialog open={open} busy={flow.isBusy} onOpenChange={onDialogOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="two-factor-setup-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t(`${flow.step}.description`)}</DialogDescription>
        </DialogHeader>

        {flow.error !== null && (
          <p className="text-sm text-destructive" role="alert" data-testid="two-factor-setup-error">
            {flow.error}
          </p>
        )}

        {flow.step === SETUP_STEP.REAUTH && (
          <ReauthStep hasPassword={hasPassword} isBusy={flow.isBusy} onContinue={flow.start} />
        )}

        {flow.step === SETUP_STEP.SCAN && flow.setup !== null && (
          <ScanStep setup={flow.setup} onContinue={flow.goToConfirm} />
        )}

        {flow.step === SETUP_STEP.CONFIRM && (
          <ConfirmStep isBusy={flow.isBusy} onConfirm={flow.confirm} onBack={flow.goToScan} />
        )}

        {flow.step === SETUP_STEP.RECOVERY_CODES && (
          <RecoveryCodesStep codes={flow.recoveryCodes} onDone={close} />
        )}
      </DialogContent>
    </Dialog>
  );
}
