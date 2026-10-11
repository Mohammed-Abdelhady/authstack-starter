import * as React from 'react';
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
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              <span className="font-medium">{t('currentRole')}</span>{' '}
              {role ? (
                <Badge dir="ltr" variant="secondary" data-testid="user-permissions-role">
                  {role}
                </Badge>
              ) : (
                <Badge variant="secondary">{t('noRole')}</Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
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
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm text-amber-900 dark:text-amber-100">
            <strong>{t('wildcardTitle')}</strong> {t('wildcardDescription')}
          </p>
        </div>
      )}
    </>
  );
}
