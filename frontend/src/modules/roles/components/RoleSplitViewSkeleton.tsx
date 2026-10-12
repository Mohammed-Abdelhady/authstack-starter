import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';

export function RoleSplitViewSkeleton() {
  const t = useTranslations('roles');

  return (
    <div
      role="status"
      aria-live="polite"
      className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6"
      data-testid="loading-skeleton"
    >
      <span className="sr-only">{t('loading')}</span>
      {/* Sidebar skeleton */}
      <div className="space-y-2 rounded-lg border border-border p-3 bg-card">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between p-3 rounded-md bg-muted/40">
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-4 w-12 rounded-full" />
          </div>
        ))}
      </div>

      {/* Content panel skeleton */}
      <div className="space-y-6 rounded-lg border border-border p-6 bg-card">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-16 rounded-md" />
            <Skeleton className="h-8 w-16 rounded-md" />
          </div>
        </div>
        <div className="space-y-3 pt-4">
          <Skeleton className="h-4 w-28" />
          <div className="space-y-2">
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}
