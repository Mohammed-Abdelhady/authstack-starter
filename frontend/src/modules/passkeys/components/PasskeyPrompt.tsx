'use client';

import { useTranslations } from 'next-intl';
import { Fingerprint, Loader2, type LucideIcon } from 'lucide-react';
import { FormRootError } from '@/components/forms';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PasskeyPromptProps {
  label: string;
  /** Translated, or null while nothing has gone wrong. */
  error: string | null;
  isBusy: boolean;
  onRun: () => void;
  icon?: LucideIcon;
  variant?: ButtonProps['variant'];
  className?: string;
  testId: string;
}

/**
 * The control that opens the browser prompt, with room above it for whatever
 * the ceremony or the backend said. Sign-in and the second factor both render
 * this; only the label and the button weight differ.
 */
export function PasskeyPrompt({
  label,
  error,
  isBusy,
  onRun,
  icon: Icon = Fingerprint,
  variant = 'default',
  className,
  testId,
}: PasskeyPromptProps) {
  const t = useTranslations('common');

  return (
    <div className={cn('mx-auto max-w-xs', className)}>
      <FormRootError id={`${testId}-error`} error={error} testId={`${testId}-error`} />

      <Button
        type="button"
        variant={variant}
        className="w-full"
        onClick={onRun}
        busy={isBusy}
        aria-busy={isBusy}
        data-testid={testId}
      >
        {isBusy ? (
          <Loader2 className="me-2 h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
        ) : (
          <Icon className="me-2 h-4 w-4" aria-hidden="true" />
        )}
        {label}
        {isBusy && <span className="sr-only">{` (${t('loading')})`}</span>}
      </Button>
    </div>
  );
}
