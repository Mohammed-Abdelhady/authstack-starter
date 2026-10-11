import { memo } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PermissionNodeProps {
  /**
   * Permission string (e.g., "users:read:all")
   */
  permission: string;

  /**
   * Node depth level for indentation
   */
  level?: number;

  /**
   * Visual variant
   */
  variant?: 'default' | 'inherited' | 'direct';

  /**
   * Optional className
   */
  className?: string;
}

/**
 * PermissionNode - Single permission display in tree
 *
 * Features:
 * - Indentation based on level
 * - Visual variants for inherited/direct permissions
 * - Minimal aesthetic
 *
 * @example
 * ```tsx
 * <PermissionNode permission="users:read:all" level={1} variant="inherited" />
 * ```
 */
export const PermissionNode = memo(function PermissionNode({
  permission,
  level = 0,
  variant = 'default',
  className,
}: PermissionNodeProps) {
  // Parse permission parts
  const parts = permission.split(':');
  const resource = parts[0] || permission;
  const action = parts[1];
  const scope = parts[2];

  // Variant styles
  const variantStyles = {
    default: 'bg-muted border-border text-foreground',
    inherited: 'bg-info/10 border-info/30 text-info-foreground dark:bg-info/20 dark:border-info/40',
    direct:
      'bg-success/10 border-success/30 text-success-foreground dark:bg-success/20 dark:border-success/40',
  };

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-md border text-xs',
        'transition-all duration-150',
        variantStyles[variant],
        className,
      )}
      style={{ marginInlineStart: `${level * 16}px` }}
      data-testid={`permission-node-${permission}`}
    >
      {level > 0 && (
        <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground rtl:rotate-180" />
      )}
      <code className="font-mono flex-1">
        <span dir="ltr">
          <span className="font-semibold">{resource}</span>
          {action && <span className="text-muted-foreground">:{action}</span>}
          {scope && <span className="text-tertiary">:{scope}</span>}
        </span>
      </code>
    </div>
  );
});
