'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { FormRootError } from '@/components/forms';
import { toast } from '@/lib/toast';
import { useFeatureDisabledHandler } from '@/modules/auth/hooks/useFeatureDisabled';
import { translatableErrorCode } from '@/modules/auth/utils/errorCodeMessage';
import { useDeletePasskeyMutation } from '../api';
import type { PasskeySummary } from '../types';
import { useSingleFlight } from '@/hooks/useSingleFlight';

interface PasskeyDeleteDialogProps {
  open: boolean;
  /** The passkey to remove. Held while the dialog fades out. */
  passkey: PasskeySummary | null;
  onClose: () => void;
}

/**
 * Removes a passkey.
 *
 * The backend refuses the last one on an account that has no other way in,
 * which arrives as PASSKEY_LAST_SIGN_IN_METHOD and is shown here rather than
 * as a toast: the dialog is where the decision is being made.
 */
export function PasskeyDeleteDialog({ open, passkey, onClose }: PasskeyDeleteDialogProps) {
  const t = useTranslations('settings.passkeys.delete');
  const tCommon = useTranslations('common');
  const tCodes = useTranslations('errors.codes');
  const [deletePasskey, { isLoading }] = useDeletePasskeyMutation();
  const handleFeatureDisabled = useFeatureDisabledHandler();
  const [error, setError] = useState<string | null>(null);

  // The dialog stays mounted between passkeys, so a refusal is dropped on the
  // way out rather than kept for whichever passkey opens it next.
  const close = useCallback(() => {
    setError(null);
    onClose();
  }, [onClose]);

  const name = passkey?.name ?? '';

  const confirmRemoval = useCallback(async () => {
    if (!passkey) {
      return;
    }
    try {
      await deletePasskey(passkey.id).unwrap();
      toast.success(t('success'));
      close();
    } catch (err) {
      if (handleFeatureDisabled(err)) {
        close();
        return;
      }
      setError(tCodes(translatableErrorCode(err)));
    }
  }, [close, deletePasskey, handleFeatureDisabled, passkey, t, tCodes]);
  const onConfirm = useSingleFlight(confirmRemoval);

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && close()}>
      <AlertDialogContent data-testid="passkey-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('description', { name })}</AlertDialogDescription>
        </AlertDialogHeader>

        <FormRootError id="passkey-delete-error" error={error} testId="passkey-delete-error" />

        <AlertDialogFooter>
          <AlertDialogCancel data-testid="passkey-delete-cancel">
            {tCommon('cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Keeps the dialog open so a refused removal can say why.
              event.preventDefault();
              void onConfirm();
            }}
            disabled={isLoading}
            aria-busy={isLoading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="passkey-delete-confirm"
          >
            {isLoading && (
              <Loader2 className="me-2 h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
            )}
            {t('submit')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
