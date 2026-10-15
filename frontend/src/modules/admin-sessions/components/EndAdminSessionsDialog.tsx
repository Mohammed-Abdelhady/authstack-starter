'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { RoleAudience } from '@app/core';
import { usePermission } from '@/modules/permissions';
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
import { canEndSessions } from '../utils/canEndSessions';

interface Props {
  scope: AdminSessionScope;
  target: SessionEndTarget;
  targetClass: RoleAudience | undefined;
  canConfirm: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onUnknown: () => void;
  landing: RemovalLanding;
}

export function EndAdminSessionsDialog({
  scope,
  target,
  targetClass,
  canConfirm,
  onClose,
  onSuccess,
  onUnknown,
  landing,
}: Props) {
  const t = useTranslations('adminSessions');
  const { permissions } = usePermission();
  const tSessions = useTranslations('sessions');
  const tCommon = useTranslations('common');
  const { noteRemoved, focusLanding } = useRemovalFocus(landing);
  const succeed = useCallback(() => {
    noteRemoved();
    onSuccess();
  }, [noteRemoved, onSuccess]);
  const { end, busy, refusal, unknown } = useEndAdminSessions({
    scope,
    targetClass,
    onSuccess: succeed,
    onUnknown,
  });
  const closeButton = useRef<HTMLButtonElement>(null);
  const allowed = canConfirm && canEndSessions(permissions, targetClass);
  const canSubmit = allowed && !unknown;
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
        {!allowed && !unknown && (
          <p role="status" className="text-sm">
            {t('unavailable')}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel ref={closeButton} data-testid="admin-session-confirm-cancel">
            {unknown || !allowed ? tCommon('close') : tCommon('cancel')}
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
