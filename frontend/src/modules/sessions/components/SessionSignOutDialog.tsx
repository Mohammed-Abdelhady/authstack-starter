'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import type { Session } from '@app/sdk';
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
import { useRefusalText } from '@/hooks/useRefusalText';
import { useRemovalFocus, type RemovalLanding } from '@/hooks/useRemovalFocus';
import { showsOwnRefusal } from '@/lib/refusal';
import { reportUnlessHandled } from '@/lib/requestFailure';
import { toast } from '@/lib/toast';
import { useDeleteSessionMutation } from '../api/sessionsApi';

/** The session a sign-out was asked for, as it was when the dialog opened. */
export interface SignOutTarget {
  readonly id: string;
  readonly deviceName: string;
}

interface SessionSignOutDialogProps {
  readonly open: boolean;
  /** Kept as it was at opening: the list may change while the dialog is up. */
  readonly target: SignOutTarget | null;
  /** The list as it is now, to tell when the session has ended elsewhere. */
  readonly sessions: readonly Session[] | undefined;
  readonly onClose: () => void;
  /** The heading that takes focus once the session is gone, and its card with it. */
  readonly landing?: RemovalLanding;
}

/**
 * Confirms signing one session out. It names and sends the session it was
 * opened for, whatever the list does meanwhile, and when that session is no
 * longer in the list it says so and offers nothing but closing.
 */
export function SessionSignOutDialog({
  open,
  target,
  sessions,
  onClose,
  landing,
}: SessionSignOutDialogProps) {
  const t = useTranslations('sessions');
  const tCommon = useTranslations('common');
  const refusalText = useRefusalText();
  const [deleteSession, { isLoading }] = useDeleteSessionMutation();
  const [refusal, setRefusal] = useState<string | null>(null);
  const { noteRemoved, focusLanding } = useRemovalFocus(landing);
  const closeRef = useRef<HTMLButtonElement>(null);

  const isListed = sessions?.some((session) => session.id === target?.id) ?? true;
  const isGone = open && !isLoading && !isListed;

  // The confirm button leaves with the session, and the focus must not go with it.
  useEffect(() => {
    if (isGone) closeRef.current?.focus();
  }, [isGone]);

  const close = () => {
    setRefusal(null);
    // Its card is gone, so there is no opener to go back to.
    if (isGone) noteRemoved();
    onClose();
  };

  const signOut = async () => {
    if (!target) return;
    setRefusal(null);
    try {
      await showsOwnRefusal(deleteSession(target.id)).unwrap();
      toast.success(t('logoutSuccess'));
      noteRemoved();
      onClose();
    } catch (error) {
      setRefusal(refusalText(error));
      reportUnlessHandled(error);
    }
  };

  return (
    <AlertDialog open={open} busy={isLoading} onOpenChange={(next) => !next && close()}>
      <AlertDialogContent
        data-testid="logout-session-confirm-dialog"
        onCloseAutoFocus={focusLanding}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t('logoutConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t.rich('logoutConfirmDescription', {
              device: target?.deviceName ?? '',
              strong: (chunks) => <strong data-testid="logout-session-device">{chunks}</strong>,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {isGone ? (
          <p role="alert" className="text-sm text-foreground" data-testid="logout-session-gone">
            {t('alreadyEnded')}
          </p>
        ) : (
          <FormRootError error={refusal} className="mb-0" testId="logout-session-error" />
        )}
        <AlertDialogFooter>
          <AlertDialogCancel ref={closeRef} data-testid="cancel-logout-button">
            {isGone ? tCommon('close') : tCommon('cancel')}
          </AlertDialogCancel>
          {!isGone && (
            <AlertDialogAction
              onClick={(event) => {
                // Stays open until the answer arrives, so focus has one place to go.
                event.preventDefault();
                void signOut();
              }}
              aria-busy={isLoading}
              data-testid="confirm-logout-button"
              className={DESTRUCTIVE_FILL_CLASSES}
            >
              {isLoading && (
                <Loader2 className="me-2 h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
              )}
              {t('logout')}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
