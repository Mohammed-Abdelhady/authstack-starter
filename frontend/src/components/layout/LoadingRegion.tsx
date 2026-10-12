import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface LoadingRegionProps {
  /**
   * Announced to screen readers while the region is busy. Guards and pages pass
   * a translated string; leave it out for purely decorative placeholders.
   */
  label?: string;

  /** Number of skeleton rows to draw. */
  rows?: number;

  className?: string;

  testId?: string;
}

/**
 * Placeholder shown while a guard, provider or lazy chunk resolves.
 * Replaces the blank screens that guards used to render.
 */
export function LoadingRegion({
  label,
  rows = 3,
  className,
  testId = 'loading-region',
}: LoadingRegionProps): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={testId}
      className={cn('flex min-h-[60vh] w-full items-center justify-center p-6', className)}
    >
      <div className="w-full max-w-md space-y-4" aria-hidden="true">
        <Skeleton className="h-8 w-1/2" />
        {Array.from({ length: rows }, (_, row) => (
          <Skeleton key={row} className="h-20 w-full" />
        ))}
      </div>
      {label && <span className="sr-only">{label}</span>}
    </div>
  );
}
