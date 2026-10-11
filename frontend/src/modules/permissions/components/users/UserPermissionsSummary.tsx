import * as React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

export interface UserPermissionsSummaryProps {
  role?: string;
  totalCount: number;
  inheritedCount: number;
  directCount: number;
  hasWildcard: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function UserPermissionsSummary({
  role,
  totalCount,
  inheritedCount,
  directCount,
  hasWildcard,
  t,
}: UserPermissionsSummaryProps): React.JSX.Element {
  return (
    <>
      <div className="rounded-lg border border-border bg-muted p-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
              <span className="font-medium">{t('currentRole')}</span>{' '}
              {role ? (
                <Badge
                  dir="ltr"
                  variant="secondary"
                  className="block min-w-0 truncate"
                  data-testid="user-permissions-role"
                >
                  {role}
                </Badge>
              ) : (
                <Badge variant="secondary">{t('noRole')}</Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('totalPermissions', { count: totalCount })} (
              {t('inheritedAndDirect', {
                inherited: inheritedCount,
                direct: directCount,
              })}
              )
            </p>
          </div>
        </div>
      </div>

      {hasWildcard && (
        <Alert variant="warning" role="note">
          <AlertDescription>
            <strong>{t('wildcardTitle')}</strong> {t('wildcardDescription')}
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
