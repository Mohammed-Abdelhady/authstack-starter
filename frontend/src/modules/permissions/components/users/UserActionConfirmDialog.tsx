'use client';

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
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The three state changes a user row can confirm. */
export type UserConfirmAction = 'activate' | 'deactivate' | 'delete';

interface ConfirmActionCopy {
  /** Heading key inside the users.actions namespace */
  titleKey: string;
  /** Body key; the message wraps the user name in <strong> */
  descriptionKey: string;
  /** Label key for the confirm button */
  confirmKey: string;
  /** Paints the confirm button red */
  destructive: boolean;
}

const CONFIRM_ACTION_COPY: Record<UserConfirmAction, ConfirmActionCopy> = {
  activate: {
    titleKey: 'activateTitle',
    descriptionKey: 'activateDescription',
    confirmKey: 'activateConfirm',
    destructive: false,
  },
  deactivate: {
    titleKey: 'deactivateTitle',
    descriptionKey: 'deactivateDescription',
    confirmKey: 'deactivateConfirm',
    destructive: false,
  },
  delete: {
    titleKey: 'deleteTitle',
    descriptionKey: 'deleteDescription',
    confirmKey: 'deleteConfirm',
    destructive: true,
  },
};

export interface UserActionConfirmDialogProps {
  /** Action awaiting confirmation, or null when the dialog is closed */
  action: UserConfirmAction | null;
  /** Name shown inside the confirmation message */
  userName: string;
  /** Whether the action is running */
  isLoading: boolean;
  /** Runs the action */
  onConfirm: () => void;
  /** Closes the dialog without acting */
  onCancel: () => void;
}

/**
 * Confirmation dialog shared by the activate, deactivate and delete user actions.
 */
export function UserActionConfirmDialog({
  action,
  userName,
  isLoading,
  onConfirm,
  onCancel,
}: UserActionConfirmDialogProps) {
  const t = useTranslations('users.actions');
  const copy = action ? CONFIRM_ACTION_COPY[action] : null;

  return (
    <AlertDialog open={action !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent data-testid="user-action-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{copy ? t(copy.titleKey) : ''}</AlertDialogTitle>
          <AlertDialogDescription>
            {copy
              ? t.rich(copy.descriptionKey, {
                  name: userName,
                  strong: (chunks) => (
                    <strong>
                      <span dir="auto">{chunks}</span>
                    </strong>
                  ),
                })
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading} data-testid="cancel-user-action-button">
            {t('cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isLoading}
            aria-busy={isLoading}
            data-testid="confirm-user-action-button"
            className={cn(copy?.destructive && 'bg-red-600 hover:bg-red-700 focus:ring-red-600')}
          >
            {isLoading && (
              <Loader2 className="me-2 h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
            )}
            {copy ? t(copy.confirmKey) : ''}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
