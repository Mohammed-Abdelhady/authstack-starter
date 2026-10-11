'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { usePermissionLabel } from '../../hooks/usePermissionLabel';

export interface SearchPermissionGridProps {
  permissions: Record<string, string>;
  selectedPermissions: string[];
  onTogglePermission: (permission: string) => void;
  isLoading?: boolean;
}

export function SearchPermissionGrid({
  permissions,
  selectedPermissions,
  onTogglePermission,
  isLoading = false,
}: SearchPermissionGridProps) {
  const formatPermissionLabel = usePermissionLabel();

  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted p-4">
      {Object.entries(permissions).map(([, permission]) => (
        <div key={permission} className="flex items-start gap-3">
          <Checkbox
            id={`permission-${permission}`}
            checked={selectedPermissions.includes(permission)}
            onCheckedChange={() => onTogglePermission(permission)}
            disabled={isLoading}
            data-testid={`permission-checkbox-${permission}`}
          />
          <div className="flex-1">
            <Label
              htmlFor={`permission-${permission}`}
              className="cursor-pointer text-sm leading-tight"
            >
              {formatPermissionLabel(permission)}
            </Label>
            <p className="mt-0.5 text-xs text-tertiary font-mono">
              <span dir="ltr">{permission}</span>
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
