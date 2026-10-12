'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useRefusalText } from '@/hooks/useRefusalText';

interface ListReadFailureProps {
  /** What the read failed with. Its reason is shown in the page's language. */
  error: unknown;
  onRetry: () => void;
  isRetrying?: boolean;
  /** Test id of the Retry button. */
  retryTestId: string;
}

interface ListLoadErrorProps extends ListReadFailureProps {
  /** What could not be loaded, as a sentence. */
  children: ReactNode;
}

/** A list that could not be loaded at all: it stands in for the list. */
export function ListLoadError({
  children,
  error,
  onRetry,
  isRetrying = false,
  retryTestId,
}: ListLoadErrorProps) {
  const tCommon = useTranslations('common');
  const refusalText = useRefusalText();

  return (
    <Alert variant="destructive" data-testid="error-state">
      <AlertDescription className="flex items-center justify-between gap-3">
        <span>
          {children} {refusalText(error)}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          busy={isRetrying}
          aria-busy={isRetrying}
          data-testid={retryTestId}
        >
          {tCommon('retry')}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/**
 * A list that is on screen and could not be read again. It says so above the
 * list and leaves the list, and anything open over it, where it is.
 */
export function StaleListNotice({
  error,
  onRetry,
  isRetrying = false,
  retryTestId,
}: ListReadFailureProps) {
  const tCommon = useTranslations('common');
  const refusalText = useRefusalText();

  return (
    <Alert variant="warningSoft" role="status" className="mb-4" data-testid="stale-list-notice">
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>
          {tCommon('refreshFailed')} {refusalText(error)}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          busy={isRetrying}
          aria-busy={isRetrying}
          data-testid={retryTestId}
        >
          {tCommon('retry')}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
