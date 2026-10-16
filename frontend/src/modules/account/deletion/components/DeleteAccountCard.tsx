'use client';

import { useCallback, useState, type MouseEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
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
import { Button, DESTRUCTIVE_FILL_CLASSES } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormRootError } from '@/components/forms';
import { useRefusalText } from '@/hooks/useRefusalText';
import { useSingleFlight } from '@/hooks/useSingleFlight';
import { showsOwnRefusal } from '@/lib/refusal';
import { toast } from '@/lib/toast';
import { useDeleteOwnAccountMutation } from '../api/accountDeletionApi';

/** The time erasure starts, in the reader's zone with the zone named, as the mail names its own. */
const ERASURE_TIME = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
} satisfies Intl.DateTimeFormatOptions;

/**
 * The settings card that deletes the person's own account once they confirm.
 * Client side for the dialog and the request. The deletion ends this
 * browser's session too, and the refetched user takes the app from there.
 */
export function DeleteAccountCard() {
  const t = useTranslations('accountDeletion');
  const format = useFormatter();
  const refusalText = useRefusalText();
  const [deleteAccount, { isLoading }] = useDeleteOwnAccountMutation();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDialog = useCallback(() => setOpen(true), []);
  // A refusal belongs to the attempt it answered, so closing drops it.
  const close = useCallback(() => {
    setError(null);
    setOpen(false);
  }, []);
  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!next) close();
    },
    [close],
  );

  const confirmDeletion = useCallback(async () => {
    try {
      const result = await showsOwnRefusal(deleteAccount()).unwrap();
      toast.success(
        result.eraseAfter === undefined
          ? t('deleted')
          : t('erasedAfter', { date: format.dateTime(new Date(result.eraseAfter), ERASURE_TIME) }),
      );
      close();
    } catch (err) {
      setError(refusalText(err));
    }
  }, [close, deleteAccount, format, refusalText, t]);
  const onConfirm = useSingleFlight(confirmDeletion);
  const onConfirmClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      // Keeps the dialog open so a refused deletion can say why.
      event.preventDefault();
      void onConfirm();
    },
    [onConfirm],
  );

  return (
    <Card data-testid="account-deletion-card">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={openDialog} data-testid="account-deletion-open">
          {t('delete')}
        </Button>
      </CardContent>
      <AlertDialog open={open} busy={isLoading} onOpenChange={onOpenChange}>
        <AlertDialogContent data-testid="account-deletion-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('confirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <FormRootError
            id="account-deletion-error"
            error={error}
            testId="account-deletion-error"
          />
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="account-deletion-cancel">
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmClick}
              busy={isLoading}
              aria-busy={isLoading}
              className={DESTRUCTIVE_FILL_CLASSES}
              data-testid="account-deletion-confirm"
            >
              {isLoading && (
                <Loader2 className="me-2 h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
              )}
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
