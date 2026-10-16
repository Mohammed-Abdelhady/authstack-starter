'use client';
// Requires form state, request hooks, and the browser authenticator.

import { useCallback, useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { getTextDirection } from '@/i18n/direction';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { filterDigits } from '@/modules/auth/utils/digitFilter';
import { FormRootError } from '@/components/forms';
import { useFreshProof } from '../hooks/useFreshProof';
import { PROOF_CODE_LENGTH, PROOF_CODE_PATTERN } from '../constants/invitations';
import { invitationErrorKey } from '../utils/invitationErrors';
import type { ProofMethod } from '../types/invitation.types';

interface Props {
  methods: ProofMethod[];
  onProved: () => Promise<unknown>;
  onCancel: () => void;
}

export function FreshProofDialog({ methods, onProved, onCancel }: Props) {
  const t = useTranslations('invitations');
  const locale = useLocale();
  const proof = useFreshProof(onProved);
  const [code, setCode] = useState('');
  const codeId = useId();
  const changeCode = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      setCode(filterDigits(event.target.value, PROOF_CODE_LENGTH)),
    [],
  );
  const changeOpen = useCallback(
    (open: boolean) => {
      if (!open) onCancel();
    },
    [onCancel],
  );
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void proof.email(code);
    },
    [proof, code],
  );

  return (
    <Dialog open onOpenChange={changeOpen} busy={proof.busy}>
      <DialogContent dir={getTextDirection(locale)} data-testid="invitation-proof-dialog">
        <DialogHeader>
          <DialogTitle>{t('proof.title')}</DialogTitle>
          <DialogDescription>{t('proof.description')}</DialogDescription>
        </DialogHeader>
        <FormRootError
          error={
            proof.browserFailed
              ? t('errors.passkeyFailed')
              : proof.error
                ? t(`errors.${invitationErrorKey(proof.error)}`)
                : null
          }
        />
        {methods.includes('passkey') && (
          <Button onClick={proof.passkey} busy={proof.busy} data-testid="invitation-proof-passkey">
            {t('proof.passkey')}
          </Button>
        )}
        {methods.includes('email-code') && (
          <div className="space-y-3">
            <Button
              variant="outline"
              onClick={proof.send}
              busy={proof.busy}
              data-testid="invitation-proof-send"
            >
              {t('proof.send')}
            </Button>
            {proof.expires !== null && (
              <form onSubmit={submit} className="space-y-3" data-testid="invitation-proof-form">
                <p role="status">{t('proof.sent', { minutes: proof.expires })}</p>
                <Label htmlFor={codeId}>{t('proof.code')}</Label>
                <Input
                  id={codeId}
                  value={code}
                  onChange={changeCode}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern={PROOF_CODE_PATTERN.source}
                  maxLength={PROOF_CODE_LENGTH}
                  dir="ltr"
                  busy={proof.busy}
                  required
                  data-testid="invitation-proof-code"
                />
                <Button
                  type="submit"
                  busy={proof.busy}
                  disabled={!PROOF_CODE_PATTERN.test(code)}
                  data-testid="invitation-proof-verify"
                >
                  {t('proof.verify')}
                </Button>
              </form>
            )}
          </div>
        )}
        <Button
          variant="outline"
          onClick={onCancel}
          busy={proof.busy}
          data-testid="invitation-proof-cancel"
        >
          {t('cancel')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
