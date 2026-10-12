import { Skeleton } from '@/components/ui/skeleton';

export interface UserListSkeletonProps {
  label: string;
}

export function UserListSkeleton({ label }: UserListSkeletonProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
      data-testid="loading-skeleton"
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="p-4 rounded-lg bg-card border border-border space-y-3">
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5 min-w-0">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="flex items-center justify-between gap-2 pt-2">
            <Skeleton className="h-7 w-24 rounded-md" />
            <Skeleton className="h-7 w-7 rounded-md" />
          </div>
          <div className="flex items-center justify-between pt-1">
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}
