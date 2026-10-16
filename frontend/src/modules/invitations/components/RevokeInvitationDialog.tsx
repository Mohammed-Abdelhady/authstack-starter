'use client';
// Requires confirmation state and a guarded destructive request.

import { useCallback, useState, type MouseEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { getTextDirection } from '@/i18n/direction';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { FormRootError } from '@/components/forms';
import { useSingleFlight } from '@/hooks/useSingleFlight';
import { showsOwnRefusal } from '@/lib/refusal';
import { useRevokeInvitationMutation } from '../api/invitationsApi';
import { invitationErrorKey } from '../utils/invitationErrors';
import type { AdminInvitation } from '../types/invitation.types';

interface Props {
  invitation: AdminInvitation;
  disabled: boolean;
}

export function RevokeInvitationDialog({ invitation, disabled }: Props) {
  const t = useTranslations('invitations');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [revoke, { isLoading }] = useRevokeInvitationMutation();
  const confirm = useSingleFlight(
    useCallback(async () => {
      if (disabled) return;
      setError(null);
      try {
        await showsOwnRefusal(revoke(invitation.id)).unwrap();
        setOpen(false);
      } catch (failure) {
        setError(failure);
      }
    }, [disabled, invitation.id, revoke]),
  );
  const pressConfirm = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      void confirm();
    },
    [confirm],
  );
  const changeOpen = useCallback((next: boolean) => {
    setOpen(next);
    if (next) setError(null);
  }, []);

  return (
    <AlertDialog open={open} onOpenChange={changeOpen} busy={isLoading}>
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          busy={disabled}
          data-testid={`invitation-revoke-${invitation.id}`}
        >
          {t('revoke')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent dir={getTextDirection(locale)}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('revoke')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('revokeDescription', { email: invitation.email })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FormRootError error={error ? t(`errors.${invitationErrorKey(error)}`) : null} />
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="invitation-revoke-cancel">
            {t('cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={pressConfirm}
            busy={isLoading}
            data-testid="invitation-revoke-confirm"
          >
            {t('revoke')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
