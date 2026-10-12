import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';

export function SessionTimelineSkeleton() {
  const t = useTranslations('sessions');
  return (
    <div role="status" aria-live="polite" className="space-y-4" data-testid="sessions-skeleton">
      <span className="sr-only">{t('loading')}</span>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="p-4 rounded-lg bg-card border border-border space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3 flex-1">
              <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
          <div className="space-y-1.5 pt-1">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>
      ))}
    </div>
  );
}
