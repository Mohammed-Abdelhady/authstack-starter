'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export interface PasswordVisibilityToggleProps {
  showPassword: boolean;
  onToggle: () => void;
  ariaLabel?: string;
  testId?: string;
  className?: string;
}

export function PasswordVisibilityToggle({
  showPassword,
  onToggle,
  ariaLabel,
  testId = 'password-visibility-toggle',
  className,
}: PasswordVisibilityToggleProps): React.JSX.Element {
  const t = useTranslations('auth.passwordToggle');
  const label = ariaLabel || (showPassword ? t('hide') : t('show'));

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      data-testid={testId}
      className={cn(
        'absolute end-3 top-1/2 -translate-y-1/2 flex items-center justify-center',
        'h-7 w-7 min-h-[24px] min-w-[24px] rounded-md text-muted-foreground hover:text-foreground',
        'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'transition-colors',
        className,
      )}
    >
      {showPassword ? (
        <EyeOff className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Eye className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
