'use client';

import { useState } from 'react';
import { FormRootError } from '@/components/forms';
import { useRefusalText } from '@/hooks/useRefusalText';
import { showsOwnRefusal } from '@/lib/refusal';
import { useTranslations } from 'next-intl';
import { LogOut, Loader2 } from 'lucide-react';
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
import { useRevokeAllOtherSessionsMutation } from '../api/sessionsApi';
import { toast } from '@/lib/toast';
import { reportUnlessHandled } from '@/lib/requestFailure';
import { useRemovalFocus, type RemovalLanding } from '@/hooks/useRemovalFocus';

export interface RevokeAllSessionsButtonProps {
  /** Number of other sessions that will be revoked */
  otherSessionsCount: number;
  /** Optional callback when sessions are revoked successfully */
  onSuccess?: (revokedCount: number) => void;
  /** Additional className for the button */
  className?: string;
  /** The heading that takes focus once the sessions are gone, and this button with them */
  landing?: RemovalLanding;
}

/**
 * RevokeAllSessionsButton - Button with co-located confirmation dialog.
 *
 * Implements the co-location pattern where the button manages its own
 * dialog state internally.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <RevokeAllSessionsButton otherSessionsCount={3} />
 *
 * // With success callback
 * <RevokeAllSessionsButton
 *   otherSessionsCount={3}
 *   onSuccess={(count) => console.log(`Revoked ${count} sessions`)}
 * />
 * ```
 */
export function RevokeAllSessionsButton({
  otherSessionsCount,
  onSuccess,
  className,
  landing,
}: RevokeAllSessionsButtonProps) {
  const [open, setOpen] = useState(false);
  const [revokeAllOtherSessions, { isLoading }] = useRevokeAllOtherSessionsMutation();
  const t = useTranslations('sessions');
  const tCommon = useTranslations('common');
  const { noteRemoved, focusLanding } = useRemovalFocus(landing);
  const refusalText = useRefusalText();
  const [refusal, setRefusal] = useState<string | null>(null);

  const changeOpen = (next: boolean) => {
    setRefusal(null);
    setOpen(next);
  };

  const handleRevoke = async () => {
    setRefusal(null);
    try {
      const result = await showsOwnRefusal(revokeAllOtherSessions()).unwrap();
      toast.success(t('logoutAllSuccess', { count: result.revokedCount }));
      noteRemoved();
      setOpen(false);
      onSuccess?.(result.revokedCount);
    } catch (error) {
      setRefusal(refusalText(error));
      reportUnlessHandled(error);
    }
  };

  // Don't render if there are no other sessions
  if (otherSessionsCount === 0) {
    return null;
  }

  return (
    <AlertDialog open={open} busy={isLoading} onOpenChange={changeOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          size="sm"
          busy={isLoading}
          aria-busy={isLoading}
          className={className}
          data-testid="logout-all-sessions-button"
        >
          <LogOut className="h-4 w-4 me-2" />
          {t('logoutAllOther')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent data-testid="revoke-all-confirm-dialog" onCloseAutoFocus={focusLanding}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('logoutAllConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('logoutAllConfirmDescription', { count: otherSessionsCount })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FormRootError error={refusal} className="mb-0" testId="revoke-all-error" />
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="cancel-logout-all">{tCommon('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Stays open until the answer arrives, so focus has one place to go.
              event.preventDefault();
              void handleRevoke();
            }}
            busy={isLoading}
            aria-busy={isLoading}
            data-testid="confirm-logout-all"
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 me-2 motion-safe:animate-spin" aria-hidden="true" />
                {t('loggingOut')}
              </>
            ) : (
              t('logoutAll')
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default RevokeAllSessionsButton;
