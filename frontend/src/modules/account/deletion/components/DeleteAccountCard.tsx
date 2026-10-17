'use client';

import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import type { AccountDeletionResult } from '@app/sdk';
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
import { useStaffOperation } from '@/modules/auth/hooks/useStaffOperation';
import { useStaffDialogIntent } from '@/modules/auth/hooks/useStaffDialogIntent';
import { FreshProofDialog } from '@/modules/auth/components/FreshProofDialog';
import { useAppSelector } from '@/store/hooks';
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
function useOwnDeletionView(cancelProof: () => void) {
  const userId = useAppSelector((state) => state.auth.user?.id ?? null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { capture, invalidate } = useStaffDialogIntent(open, userId);
  useEffect(() => {
    cancelProof();
  }, [open, userId, cancelProof]);
  const openDialog = useCallback(() => setOpen(true), []);
  const close = useCallback(() => {
    invalidate();
    cancelProof();
    setError(null);
    setOpen(false);
  }, [invalidate, cancelProof]);
  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!next) close();
    },
    [close],
  );
  return { userId, open, error, setError, capture, openDialog, close, onOpenChange };
}

function useOwnDeletion() {
  const t = useTranslations('accountDeletion');
  const format = useFormatter();
  const refusalText = useRefusalText();
  const [deleteAccount] = useDeleteOwnAccountMutation();
  const operation = useStaffOperation();
  const { start } = operation;
  const view = useOwnDeletionView(operation.cancelProof);
  const { open, userId, capture, setError, close } = view;
  const isLoading = operation.busy || operation.methods !== null;
  const onConfirmClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      if (!open || !userId || isLoading) return;
      setError(null);
      let result: AccountDeletionResult | undefined;
      void start({
        isCurrent: capture(),
        run: async () => {
          result = await showsOwnRefusal(deleteAccount()).unwrap();
        },
        onSuccess: () => {
          if (!result) return;
          toast.success(
            result.eraseAfter === undefined
              ? t('deleted')
              : t('erasedAfter', {
                  date: format.dateTime(new Date(result.eraseAfter), ERASURE_TIME),
                }),
          );
          close();
        },
        onError: (failure) => setError(refusalText(failure)),
      });
    },
    [
      open,
      userId,
      isLoading,
      start,
      capture,
      setError,
      deleteAccount,
      refusalText,
      t,
      format,
      close,
    ],
  );
  return { ...view, t, isLoading, onConfirmClick, operation };
}

export function DeleteAccountCard() {
  const { t, open, error, isLoading, openDialog, onOpenChange, onConfirmClick, operation } =
    useOwnDeletion();
  return (
    <>
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
      {operation.methods && (
        <FreshProofDialog
          methods={operation.methods}
          onProved={operation.proved}
          onCancel={operation.cancelProof}
        />
      )}
    </>
  );
}
