'use client';

import { useCallback, useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogoutButton } from '@/modules/auth/components/LogoutButton';
import { filterDigits } from '@/modules/auth/utils/digitFilter';
import type { PasskeyRegistrationProof, PasskeyRegistrationRequirement } from '../types';

interface PasskeyRegistrationProofFormProps {
  requirement: PasskeyRegistrationRequirement;
  proof: PasskeyRegistrationProof;
  error: string | null;
  isBusy: boolean;
  isCooling: boolean;
  onProofChange: (proof: PasskeyRegistrationProof) => void;
  onSubmit: () => void;
}

/** Collects only the fresh proof the server requested before opening WebAuthn. */
export function PasskeyRegistrationProofForm({
  requirement,
  proof,
  error,
  isBusy,
  isCooling,
  onProofChange,
  onSubmit,
}: PasskeyRegistrationProofFormProps) {
  const t = useTranslations('settings.passkeys.registration');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  const onPasswordChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onProofChange({ ...proof, password: event.target.value });
    },
    [onProofChange, proof],
  );

  const onCodeChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onProofChange({
        ...proof,
        code: filterDigits(event.target.value, 6),
        recoveryCode: undefined,
      });
    },
    [onProofChange, proof],
  );
  const onRecoveryCodeChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onProofChange({
        ...proof,
        code: undefined,
        recoveryCode: event.target.value.toUpperCase(),
      });
    },
    [onProofChange, proof],
  );
  const toggleProofMethod = useCallback(() => {
    onProofChange({ ...proof, code: undefined, recoveryCode: undefined });
    setUseRecoveryCode((current) => !current);
  }, [onProofChange, proof]);
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      onSubmit();
    },
    [onSubmit],
  );

  if (requirement === 'recent_sign_in') {
    return (
      <div className="space-y-3" data-testid="passkey-registration-recent-sign-in">
        <p className="text-sm text-destructive" role="alert" data-testid="passkey-add-error">
          {error ?? t('recentSignInRequired')}
        </p>
        <LogoutButton />
      </div>
    );
  }

  return (
    <form className="space-y-3" onSubmit={submit} data-testid="passkey-registration-proof-form">
      {error !== null && (
        <p className="text-sm text-destructive" role="alert" data-testid="passkey-add-error">
          {error}
        </p>
      )}
      {requirement === 'password' ? (
        <div className="space-y-2">
          <Label htmlFor="passkey-registration-password">{t('password')}</Label>
          <Input
            id="passkey-registration-password"
            type="password"
            autoComplete="current-password"
            dir="ltr"
            required
            value={proof.password ?? ''}
            busy={isBusy}
            onChange={onPasswordChange}
            data-testid="passkey-registration-password"
          />
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="passkey-registration-factor">
            {useRecoveryCode ? t('recoveryCode') : t('code')}
          </Label>
          <Input
            id="passkey-registration-factor"
            type="text"
            inputMode={useRecoveryCode ? undefined : 'numeric'}
            autoComplete="one-time-code"
            dir="ltr"
            required
            value={useRecoveryCode ? (proof.recoveryCode ?? '') : (proof.code ?? '')}
            busy={isBusy}
            onChange={useRecoveryCode ? onRecoveryCodeChange : onCodeChange}
            data-testid="passkey-registration-factor"
          />
          <Button
            type="button"
            variant="link"
            className="min-h-6 h-auto p-0 text-sm"
            onClick={toggleProofMethod}
            data-testid="passkey-registration-toggle-recovery"
          >
            {useRecoveryCode ? t('useCode') : t('useRecoveryCode')}
          </Button>
        </div>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={isCooling}
        busy={isBusy}
        data-testid="passkey-proof-submit"
      >
        {t('submit')}
      </Button>
    </form>
  );
}
