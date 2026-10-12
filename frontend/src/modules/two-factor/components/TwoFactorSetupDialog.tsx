'use client';

import { useCallback, useEffect, useRef } from 'react';
import { FOCUS_LANDING_CLASSES } from '@/constants/focusStyles';
import { useRemovalFocus, type RemovalLanding } from '@/hooks/useRemovalFocus';
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
  /** The section heading takes focus after setup replaces its opener. */
  landing?: RemovalLanding;
}

/** Turns the second factor on, one step at a time. */
export function TwoFactorSetupDialog({
  open,
  onOpenChange,
  hasPassword,
  landing,
}: TwoFactorSetupDialogProps) {
  const t = useTranslations('settings.twoFactor.setup');
  const flow = useTwoFactorSetup();
  const { reset } = flow;
  const { noteRemoved, focusLanding } = useRemovalFocus(landing);

  useEffect(() => {
    if (!open) {
      reset();
    }
  }, [open, reset]);

  useEffect(() => {
    if (landing !== undefined && flow.step === SETUP_STEP.RECOVERY_CODES) {
      noteRemoved();
    }
  }, [flow.step, landing, noteRemoved]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  // A step replaces the control that asked for it. Unless the new step put
  // the focus on a field of its own, the title takes it.
  const contentRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(flow.step);
  useEffect(() => {
    if (shownStep.current === flow.step) return;
    shownStep.current = flow.step;
    const content = contentRef.current;
    const active = document.activeElement;
    const stepTookFocus = content !== null && active !== content && content.contains(active);
    if (!stepTookFocus) titleRef.current?.focus();
  }, [flow.step]);

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
      <DialogContent
        ref={contentRef}
        className="sm:max-w-md"
        data-testid="two-factor-setup-dialog"
        showCloseButton={flow.step !== SETUP_STEP.RECOVERY_CODES}
        onCloseAutoFocus={focusLanding}
      >
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1} className={FOCUS_LANDING_CLASSES}>
            {t('title')}
          </DialogTitle>
          {/* Announce both the position and instructions when the step changes. */}
          <DialogDescription aria-live="polite">
            {t('stepProgress', {
              current: Object.values(SETUP_STEP).indexOf(flow.step) + 1,
              total: Object.values(SETUP_STEP).length,
            })}{' '}
            {t(`${flow.step}.description`)}
          </DialogDescription>
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
