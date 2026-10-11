'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface RoleListErrorProps {
  onRetry: () => void;
  /** Read out as it appears. Leave it off where many of these show at once. */
  announce?: boolean;
  className?: string;
  testId?: string;
}

/**
 * Shown in place of a role selector whose list could not be read. A list that
 * is missing must not pass for a list with fewer roles in it.
 */
export function RoleListError({
  onRetry,
  announce = false,
  className,
  testId,
}: RoleListErrorProps) {
  const t = useTranslations('users');
  const tCommon = useTranslations('common');

  return (
    <div
      role={announce ? 'alert' : undefined}
      className={cn('flex flex-wrap items-center gap-2 text-sm', className)}
      data-testid={testId}
    >
      <span>{t('roleFilterError')}</span>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        {tCommon('retry')}
      </Button>
    </div>
  );
}
