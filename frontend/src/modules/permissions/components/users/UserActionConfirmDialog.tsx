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
import { FormRootError } from '@/components/forms';

/** The two state changes a user row can confirm. */
export type UserConfirmAction = 'activate' | 'deactivate';

interface ConfirmActionCopy {
  /** Heading key inside the users.actions namespace */
  titleKey: string;
  /** Body key; the message wraps the user name in <strong> */
  descriptionKey: string;
  /** Label key for the confirm button */
  confirmKey: string;
}

const CONFIRM_ACTION_COPY: Record<UserConfirmAction, ConfirmActionCopy> = {
  activate: {
    titleKey: 'activateTitle',
    descriptionKey: 'activateDescription',
    confirmKey: 'activateConfirm',
  },
  deactivate: {
    titleKey: 'deactivateTitle',
    descriptionKey: 'deactivateDescription',
    confirmKey: 'deactivateConfirm',
  },
};

export interface UserActionConfirmDialogProps {
  /** Action awaiting confirmation, or null when the dialog is closed */
  action: UserConfirmAction | null;
  /** Name shown inside the confirmation message */
  userName: string;
  /** Whether the action is running */
  isLoading: boolean;
  /** Why the last attempt was refused, shown while the dialog stays open */
  refusal?: string | null;
  /** Runs the action */
  onConfirm: () => void;
  /** Closes the dialog without acting */
  onCancel: () => void;
  /** Runs when the dialog has closed, to put focus back on what opened it */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Confirmation dialog shared by the activate and deactivate user actions.
 */
export function UserActionConfirmDialog({
  action,
  userName,
  isLoading,
  refusal,
  onConfirm,
  onCancel,
  onCloseAutoFocus,
}: UserActionConfirmDialogProps) {
  const t = useTranslations('users.actions');
  const copy = action ? CONFIRM_ACTION_COPY[action] : null;

  return (
    // The confirmation stays until the request has an answer.
    <AlertDialog
      open={action !== null}
      busy={isLoading}
      onOpenChange={(open) => !open && onCancel()}
    >
      <AlertDialogContent
        data-testid="user-action-confirm-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
      >
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
        <FormRootError error={refusal} className="mb-0" testId="user-action-error" />
        <AlertDialogFooter>
          <AlertDialogCancel busy={isLoading} data-testid="cancel-user-action-button">
            {t('cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Closes when the change is accepted, not when it is asked for.
              event.preventDefault();
              onConfirm();
            }}
            busy={isLoading}
            aria-busy={isLoading}
            data-testid="confirm-user-action-button"
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
