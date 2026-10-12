'use client';

import { Heading } from '@/components/design-system';
import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { Lock, Shield } from 'lucide-react';
import { FOCUS_RING_CLASSES } from '@/constants/focusStyles';
import { cn } from '@/lib/utils';
import type { Role } from '../../api/rolesApi';

export interface RoleSidebarNavProps {
  /**
   * All available roles
   */
  roles: Role[];

  /**
   * Currently selected role ID
   */
  selectedRoleId: string | null;

  /**
   * Callback when a role is selected
   */
  onSelectRole: (roleId: string) => void;

  /**
   * Loading state
   */
  isLoading?: boolean;
}

/**
 * RoleSidebarNav - Navigation sidebar for roles management
 *
 * Features:
 * - System and custom roles grouped separately
 * - Active role highlighted
 * - System/protected badges
 * - Minimal aesthetic with refined hover states
 *
 * @example
 * ```tsx
 * <RoleSidebarNav
 *   roles={roles}
 *   selectedRoleId={selectedRoleId}
 *   onSelectRole={setSelectedRoleId}
 * />
 * ```
 */
export const RoleSidebarNav = memo(function RoleSidebarNav({
  roles,
  selectedRoleId,
  onSelectRole,
  isLoading = false,
}: RoleSidebarNavProps) {
  const t = useTranslations('roles.sidebar');
  const tDetail = useTranslations('roles.detail');
  const tRoles = useTranslations('roles');

  // Group roles by type
  const systemRoles = roles.filter((r) => r.isSystemRole);
  const customRoles = roles.filter((r) => !r.isSystemRole);

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="space-y-1"
        data-testid="role-sidebar-nav-loading"
      >
        <span className="sr-only">{tRoles('loading')}</span>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            aria-hidden="true"
            className="h-10 rounded-md bg-muted motion-safe:animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <nav aria-label={t('navigationLabel')} className="space-y-6" data-testid="role-sidebar-nav">
      {/* System Roles Section */}
      {systemRoles.length > 0 && (
        <section>
          <Heading level={2} variant="eyebrow" className="mb-2 px-3">
            {t('systemRoles')}
          </Heading>
          <div className="space-y-1">
            {systemRoles.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => onSelectRole(role.id)}
                aria-current={selectedRoleId === role.id ? 'true' : undefined}
                className={cn(
                  'w-full text-start px-3 py-2 rounded-md text-sm transition-all duration-150',
                  'flex items-center gap-2',
                  FOCUS_RING_CLASSES,
                  selectedRoleId === role.id
                    ? 'bg-secondary text-primary font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                data-testid={`role-nav-item-${role.slug}`}
              >
                <Shield className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <span dir="auto">{role.name}</span>
                </span>
                {role.isProtected && (
                  <>
                    <Lock
                      className="h-3 w-3 flex-shrink-0 text-status-warning"
                      aria-hidden="true"
                    />
                    <span className="sr-only">{tDetail('protectedBadge')}</span>
                  </>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Custom Roles Section */}
      {customRoles.length > 0 && (
        <section>
          <Heading level={2} variant="eyebrow" className="mb-2 px-3">
            {t('customRoles', { count: customRoles.length })}
          </Heading>
          <div className="space-y-1">
            {customRoles.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => onSelectRole(role.id)}
                aria-current={selectedRoleId === role.id ? 'true' : undefined}
                className={cn(
                  'w-full text-start px-3 py-2 rounded-md text-sm transition-all duration-150',
                  'flex items-center gap-2',
                  FOCUS_RING_CLASSES,
                  selectedRoleId === role.id
                    ? 'bg-secondary text-primary font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                data-testid={`role-nav-item-${role.slug}`}
              >
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <span dir="auto">{role.name}</span>
                </span>
                {role.isProtected && (
                  <>
                    <Lock
                      className="h-3 w-3 flex-shrink-0 text-status-warning"
                      aria-hidden="true"
                    />
                    <span className="sr-only">{tDetail('protectedBadge')}</span>
                  </>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Empty State */}
      {roles.length === 0 && (
        <div className="text-center py-8 px-3">
          <Shield className="h-8 w-8 mx-auto text-muted-foreground mb-2" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{t('noRoles')}</p>
        </div>
      )}
    </nav>
  );
});
