'use client';

import type { RefObject } from 'react';
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

interface SignOutNotConfirmedDialogProps {
  open: boolean;
  isRetrying: boolean;
  onRetry: () => void;
  onClose: () => void;
  /** The control that asked for the sign-out, which gets the focus back. */
  returnFocusTo: RefObject<HTMLElement | null>;
}

/**
 * Says that the server did not confirm a sign-out, so the session may still
 * be open, and offers to ask again. It interrupts on purpose: on a shared
 * computer the person must not walk away believing they are signed out.
 */
export function SignOutNotConfirmedDialog({
  open,
  isRetrying,
  onRetry,
  onClose,
  returnFocusTo,
}: SignOutNotConfirmedDialogProps) {
  const t = useTranslations('auth.signOut');

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent
        data-testid="sign-out-not-confirmed-dialog"
        onCloseAutoFocus={(event) => {
          // The button was disabled while the request ran and lost the focus,
          // so the dialog has no memory of where the focus came from.
          event.preventDefault();
          returnFocusTo.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t('notConfirmedTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('notConfirmedBody')}</AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel data-testid="sign-out-stay">{t('staySignedIn')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Stays open until the server answers, so a second failure is not missed.
              event.preventDefault();
              onRetry();
            }}
            disabled={isRetrying}
            aria-busy={isRetrying}
            data-testid="sign-out-retry"
          >
            {isRetrying && (
              <Loader2 className="me-2 h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
            )}
            {t('retry')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
