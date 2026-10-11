import { Alert, AlertDescription } from '@/components/ui/alert';
import { Heading } from '@/components/design-system';
import { useTranslations } from 'next-intl';
import { PermissionNode } from './PermissionNode';
import { PERMISSION_GROUPS } from '../search/SearchPermissionTabs';
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

function groupPermissions(permissions: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};

  permissions.forEach((perm) => {
    if (perm === '*') {
      groups['wildcard'] = ['*'];
      return;
    }

    const resource = perm.split(':')[0];
    if (!groups[resource]) {
      groups[resource] = [];
    }
    groups[resource].push(perm);
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

  // Check for wildcard
  const hasWildcard = permissions.includes('*');

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
        {Object.entries(groupedPermissions).map(([resource, perms]) => (
          <div key={resource} className="space-y-2">
            {/* Resource Header */}
            {showHeaders && resource !== 'wildcard' && (
              <Heading level={4} variant="eyebrow" data-testid={`permission-group-${resource}`}>
                {PERMISSION_GROUPS.some((group) => group.id === resource) ? (
                  tSelector(`groups.${resource}`)
                ) : (
                  <span dir="ltr">{resource}</span>
                )}
              </Heading>
            )}

            {/* Permission Nodes */}
            <div className="space-y-1">
              {perms.map((perm) => (
                <PermissionNode
                  key={perm}
                  permission={perm}
                  level={resource === 'wildcard' ? 0 : 0}
                  variant={variant}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
