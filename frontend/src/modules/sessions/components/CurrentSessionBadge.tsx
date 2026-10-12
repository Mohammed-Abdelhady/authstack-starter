'use client';

import { forwardRef, HTMLAttributes } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export interface CurrentSessionBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * Show pulsing animation
   */
  pulse?: boolean;
}

/**
 * CurrentSessionBadge - Pulsing "Active now" indicator
 *
 * Features:
 * - Pulsing green dot
 * - "Active now" text
 * - Minimal green accent
 * - Smooth animations
 *
 * @example
 * ```tsx
 * <CurrentSessionBadge pulse />
 * ```
 */
export const CurrentSessionBadge = forwardRef<HTMLSpanElement, CurrentSessionBadgeProps>(
  ({ pulse = true, className, ...props }, ref) => {
    const t = useTranslations('sessions');

    return (
      <span
        ref={ref}
        data-testid="current-session-badge"
        className={cn(
          'inline-flex items-center gap-1.5 text-sm font-medium text-card-foreground',
          className,
        )}
        {...props}
      >
        <span
          className={cn(
            'h-2 w-2 rounded-full bg-status-success',
            pulse && 'motion-safe:animate-pulse',
          )}
          data-testid="pulse-dot"
        />
        <span>{t('activeNow')}</span>
      </span>
    );
  },
);

CurrentSessionBadge.displayName = 'CurrentSessionBadge';
