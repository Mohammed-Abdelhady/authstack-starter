'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
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
import { useRemovalFocus, type RemovalLanding } from '@/hooks/useRemovalFocus';
import { sessionDeviceText } from '@/modules/sessions/utils/sessionDevice';
import type { AdminSessionScope, SessionEndTarget } from '../types/admin-session.types';
import { useEndAdminSessions } from '../hooks/useEndAdminSessions';

interface Props {
  scope: AdminSessionScope;
  target: SessionEndTarget;
  canConfirm: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onUnknown: () => void;
  landing: RemovalLanding;
}

export function EndAdminSessionsDialog({
  scope,
  target,
  canConfirm,
  onClose,
  onSuccess,
  onUnknown,
  landing,
}: Props) {
  const t = useTranslations('adminSessions');
  const tSessions = useTranslations('sessions');
  const tCommon = useTranslations('common');
  const { noteRemoved, focusLanding } = useRemovalFocus(landing);
  const succeed = useCallback(() => {
    noteRemoved();
    onSuccess();
  }, [noteRemoved, onSuccess]);
  const { end, busy, refusal, unknown } = useEndAdminSessions({
    scope,
    onSuccess: succeed,
    onUnknown,
  });
  const closeButton = useRef<HTMLButtonElement>(null);
  const canSubmit = canConfirm && !unknown;
  useEffect(() => {
    if (!canSubmit && !busy) closeButton.current?.focus();
  }, [canSubmit, busy]);
  const changeOpen = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  const confirm = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      if (canSubmit) void end(target);
    },
    [canSubmit, end, target],
  );
  const description =
    'all' in target
      ? t('confirmAllDescription', { user: scope.userId })
      : t('confirmOneDescription', {
          user: scope.userId,
          device: sessionDeviceText(target.session, tSessions),
          application: target.session.clientId,
        });

  return (
    <AlertDialog open busy={busy} onOpenChange={changeOpen}>
      <AlertDialogContent onCloseAutoFocus={focusLanding} data-testid="admin-session-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {'all' in target ? t('confirmAllTitle') : t('confirmOneTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <FormRootError
          error={unknown ? t('unknownOutcome') : refusal}
          testId="admin-session-end-error"
        />
        {!canConfirm && !unknown && (
          <p role="status" className="text-sm">
            {t('unavailable')}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel ref={closeButton} data-testid="admin-session-confirm-cancel">
            {unknown || !canConfirm ? tCommon('close') : tCommon('cancel')}
          </AlertDialogCancel>
          {canSubmit && (
            <AlertDialogAction
              className={DESTRUCTIVE_FILL_CLASSES}
              onClick={confirm}
              aria-busy={busy}
              data-testid="admin-session-confirm-end"
            >
              {'all' in target ? t('endAll') : t('endOne')}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
