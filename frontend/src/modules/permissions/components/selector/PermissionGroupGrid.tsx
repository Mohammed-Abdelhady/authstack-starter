'use client';

import { memo } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { usePermissionLabel } from '../../hooks/usePermissionLabel';

interface PermissionGroupGridProps {
  permissions: Record<string, string>;
  selectedPermissions: string[];
  onTogglePermission: (permission: string) => void;
  busy?: boolean;
  prefix?: string;
}

export const PermissionGroupGrid = memo(function PermissionGroupGrid({
  permissions,
  selectedPermissions,
  onTogglePermission,
  busy = false,
  prefix = '',
}: PermissionGroupGridProps) {
  const formatPermissionLabel = usePermissionLabel();

  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted p-4 sm:grid-cols-2">
      {Object.entries(permissions).map(([, permission]) => {
        const id = `permission-${permission}${prefix ? `-${prefix}` : ''}`;
        return (
          <div key={permission} className="flex items-start gap-3">
            <Checkbox
              id={id}
              checked={selectedPermissions.includes(permission)}
              onCheckedChange={() => onTogglePermission(permission)}
              busy={busy}
              data-testid={`permission-checkbox-${permission}`}
            />
            <div className="flex-1">
              <Label htmlFor={id} className="cursor-pointer text-sm leading-tight">
                {formatPermissionLabel(permission)}
              </Label>
              <p className="mt-0.5 text-xs text-tertiary font-mono">
                <span dir="ltr">{permission}</span>
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
});
