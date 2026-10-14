import { useId } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Heading } from '@/components/design-system';
import { useTranslations } from 'next-intl';
import { WILDCARD_PERMISSION } from '@app/core';
import { PermissionNode } from './PermissionNode';
import { PERMISSION_GROUPS } from '../../constants/permissionGroups';
import { Shield } from 'lucide-react';

export interface PermissionTreeViewProps {
  /**
   * Array of permission strings
   */
  permissions: string[];

  /**
   * Variant for all nodes
   */
  variant?: 'default' | 'inherited' | 'direct';

  /**
   * Show group headers
   */
  showHeaders?: boolean;

  /**
   * Optional className
   */
  className?: string;
}

/**
 * Group id of the `*` permission. Resources match `[a-z-]+`, so no resource,
 * a host resource named `wildcard` included, can share it.
 */
export const WILDCARD_GROUP_ID = '*';

/** A Map, so a resource named after an Object member such as `constructor` is its own group. */
function groupPermissions(permissions: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  permissions.forEach((perm) => {
    if (perm === WILDCARD_PERMISSION) {
      groups.set(WILDCARD_GROUP_ID, [WILDCARD_PERMISSION]);
      return;
    }

    const resource = perm.split(':')[0];
    groups.set(resource, [...(groups.get(resource) ?? []), perm]);
  });

  return groups;
}

/**
 * PermissionTreeView - Hierarchical permission display
 *
 * Features:
 * - Groups permissions by resource (users, roles, sessions, etc.)
 * - Tree-style visualization
 * - Wildcard detection and highlighting
 * - Minimal aesthetic
 *
 * @example
 * ```tsx
 * <PermissionTreeView
 *   permissions={['users:read:all', 'users:update:all', 'roles:*']}
 *   variant="inherited"
 *   showHeaders
 * />
 * ```
 */
export function PermissionTreeView({
  permissions,
  variant = 'default',
  showHeaders = true,
  className,
}: PermissionTreeViewProps) {
  const t = useTranslations('permissions.tree');
  const tSelector = useTranslations('permissions.selector');
  const groupedPermissions = groupPermissions(permissions);
  const treeId = useId();

  // Check for wildcard
  const hasWildcard = permissions.includes(WILDCARD_PERMISSION);

  if (permissions.length === 0) {
    return <div className="text-center py-8 text-sm text-muted-foreground">{t('empty')}</div>;
  }

  return (
    <div className={className} data-testid="permission-tree-view">
      {/* Wildcard Warning */}
      {hasWildcard && (
        <Alert variant="warningSoft" role="note" className="mb-4">
          <AlertDescription className="flex items-center gap-2">
            <Shield className="h-4 w-4 shrink-0 text-status-warning" aria-hidden="true" />
            <strong>{t('wildcardLabel')}</strong> {t('wildcardNotice')}
          </AlertDescription>
        </Alert>
      )}

      {/* Grouped Permissions */}
      <div className="space-y-4">
        {[...groupedPermissions].map(([resource, perms]) => (
          <div key={resource} className="space-y-2">
            {/* Resource Header */}
            {showHeaders && resource !== WILDCARD_GROUP_ID && (
              <Heading
                id={`${treeId}-group-${resource}`}
                level={4}
                variant="eyebrow"
                data-testid={`permission-group-${resource}`}
              >
                {PERMISSION_GROUPS.some(
                  (group) => group.id === resource && group.hasCatalogName,
                ) ? (
                  tSelector(`groups.${resource}`)
                ) : (
                  <span dir="ltr">{resource}</span>
                )}
              </Heading>
            )}

            {/* Permission Nodes */}
            <ul
              aria-labelledby={
                showHeaders && resource !== WILDCARD_GROUP_ID
                  ? `${treeId}-group-${resource}`
                  : undefined
              }
              className="m-0 list-none space-y-1 p-0"
              data-testid={`permission-list-${resource}`}
            >
              {perms.map((perm) => (
                <li key={perm}>
                  <PermissionNode permission={perm} level={0} variant={variant} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
