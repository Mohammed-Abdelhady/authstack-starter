'use client';

import { useCallback, useState } from 'react';
import { useRemovalFocus, type RemovalLanding } from '@/hooks/useRemovalFocus';
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
import { DESTRUCTIVE_FILL_CLASSES } from '@/components/ui/button';
import { FormRootError } from '@/components/forms';
import { toast } from '@/lib/toast';
import { useFeatureDisabledHandler } from '@/modules/auth/hooks/useFeatureDisabled';
import { useRefusalText } from '@/hooks/useRefusalText';
import { showsOwnRefusal } from '@/lib/refusal';
import { useDeletePasskeyMutation } from '../api';
import type { PasskeySummary } from '../types';
import { useSingleFlight } from '@/hooks/useSingleFlight';

interface PasskeyDeleteDialogProps {
  open: boolean;
  /** The passkey to remove. Held while the dialog fades out. */
  passkey: PasskeySummary | null;
  onClose: () => void;
  /** The heading that takes focus once the passkey is gone, and its row with it. */
  landing?: RemovalLanding;
}

/**
 * Removes a passkey.
 *
 * The backend refuses the last one on an account that has no other way in,
 * which arrives as PASSKEY_LAST_SIGN_IN_METHOD and is shown here rather than
 * as a toast: the dialog is where the decision is being made.
 */
export function PasskeyDeleteDialog({ open, passkey, onClose, landing }: PasskeyDeleteDialogProps) {
  const t = useTranslations('settings.passkeys.delete');
  const tCommon = useTranslations('common');
  const refusalText = useRefusalText();
  const [deletePasskey, { isLoading }] = useDeletePasskeyMutation();
  const handleFeatureDisabled = useFeatureDisabledHandler();
  const [error, setError] = useState<string | null>(null);
  const { noteRemoved, focusLanding } = useRemovalFocus(landing);

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
      await showsOwnRefusal(deletePasskey(passkey.id)).unwrap();
      toast.success(t('success'));
      noteRemoved();
      close();
    } catch (err) {
      if (handleFeatureDisabled(err)) {
        close();
        return;
      }
      setError(refusalText(err));
    }
  }, [close, deletePasskey, handleFeatureDisabled, passkey, noteRemoved, refusalText, t]);
  const onConfirm = useSingleFlight(confirmRemoval);

  return (
    <AlertDialog open={open} busy={isLoading} onOpenChange={(next) => !next && close()}>
      <AlertDialogContent data-testid="passkey-delete-dialog" onCloseAutoFocus={focusLanding}>
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
            busy={isLoading}
            aria-busy={isLoading}
            className={DESTRUCTIVE_FILL_CLASSES}
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
