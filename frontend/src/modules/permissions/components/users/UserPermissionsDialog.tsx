'use client';

import { HEADING_ROLE_CLASSES } from '@/constants/typography';
import { Heading } from '@/components/design-system';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  useGetUserPermissionsQuery,
  useAddPermissionMutation,
  useRemovePermissionMutation,
} from '../../api/permissionsApi';
import { useGetRoleQuery } from '../../api/rolesApi';
import { PermissionTreeView } from '../permission-tree/PermissionTreeView';
import { PermissionSearchDialog } from '../search/PermissionSearchDialog';
import { UserPermissionsSummary } from './UserPermissionsSummary';
import { Loader2, Plus, Trash2, Shield, User } from 'lucide-react';
import { toast } from '@/lib/toast';
import { reportUnlessHandled } from '@/lib/requestFailure';

export interface UserPermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  userName?: string;
}

/**
 * Dialog for viewing inherited and managing direct user permissions.
 */
export function UserPermissionsDialog({
  open,
  onOpenChange,
  userId,
  userName,
}: UserPermissionsDialogProps) {
  const t = useTranslations('permissions.dialog');
  // Component will remount when userId changes due to key prop on Dialog
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  const { data, isLoading, refetch } = useGetUserPermissionsQuery(userId || '', {
    skip: !userId,
  });

  // Fetch role permissions to show inherited permissions
  const { data: roleData, isLoading: isLoadingRole } = useGetRoleQuery(data?.role || '', {
    skip: !data?.role,
  });

  const [addPermission, { isLoading: isAdding }] = useAddPermissionMutation();
  const [removePermission, { isLoading: isRemoving }] = useRemovePermissionMutation();

  const handleAddPermissions = async () => {
    if (!userId || availablePermissions.length === 0) return;

    try {
      // Add permissions one by one
      for (const permission of availablePermissions) {
        await addPermission({ userId, permission }).unwrap();
      }

      toast.success(t('addSuccess', { count: availablePermissions.length }));

      // Reset state
      setSelectedPermissions([]);
      setSearchDialogOpen(false);

      // Refresh data
      refetch();
    } catch (error) {
      reportUnlessHandled(error);
    }
  };

  const handleRemovePermission = async (permission: string) => {
    if (!userId) return;

    try {
      await removePermission({ userId, permission }).unwrap();

      toast.success(t('removeSuccess'));

      // Refresh data
      refetch();
    } catch (error) {
      reportUnlessHandled(error);
    }
  };

  const userPermissions = data?.permissions || [];
  const rolePermissions = roleData?.permissions || [];

  // Direct permissions are those not inherited from role
  const directPermissions = userPermissions.filter((p) => !rolePermissions.includes(p));
  const inheritedPermissions = rolePermissions;

  // All effective permissions (role + direct, deduplicated)
  const effectivePermissions = [...new Set([...rolePermissions, ...userPermissions])];
  const hasWildcard = effectivePermissions.includes('*');

  // Filter out permissions the user already has when adding (both direct and inherited)
  const availablePermissions = selectedPermissions.filter((p) => !effectivePermissions.includes(p));

  return (
    <>
      <Dialog key={userId || 'no-user'} open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>
              {userName ? t('descriptionWithUser', { name: userName }) : t('descriptionGeneric')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-6">
            {isLoading || isLoadingRole ? (
              <div className="flex items-center justify-center py-12">
                <Loader2
                  className="h-8 w-8 motion-safe:animate-spin text-gray-400"
                  aria-hidden="true"
                />
              </div>
            ) : (
              <>
                <UserPermissionsSummary
                  role={data?.role}
                  totalCount={effectivePermissions.length}
                  inheritedCount={inheritedPermissions.length}
                  directCount={directPermissions.length}
                  hasWildcard={hasWildcard}
                  t={t}
                />

                {/* Inherited Permissions (Read-only) - Tree View */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <Heading level={3} variant="subsectionTitle" data-testid="inherited-heading">
                      {t('inheritedFromRole', { role: data?.role || '' })}
                    </Heading>
                    {data?.role && (
                      <Badge
                        dir="ltr"
                        variant="secondary"
                        className="text-xs"
                        data-testid="inherited-role-slug"
                      >
                        {data.role}
                      </Badge>
                    )}
                  </div>

                  {inheritedPermissions.length === 0 ? (
                    <div className="rounded-lg border border-border bg-muted p-4 text-center">
                      <p className="text-sm text-muted-foreground">{t('noInheritedPermissions')}</p>
                    </div>
                  ) : (
                    <PermissionTreeView
                      permissions={inheritedPermissions}
                      variant="inherited"
                      showHeaders
                    />
                  )}
                </div>

                {/* Direct Permissions (Editable) - Tree View with Remove Actions */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <Heading level={3} variant="subsectionTitle">
                        {t('directPermissions', { count: directPermissions.length })}
                      </Heading>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setSearchDialogOpen(true)}
                      data-testid="add-permission-button"
                    >
                      <Plus className="me-2 h-4 w-4" />
                      {t('addPermissions')}
                    </Button>
                  </div>

                  {directPermissions.length === 0 ? (
                    <div className="rounded-lg border border-border bg-muted p-4 text-center">
                      <p className="text-sm text-muted-foreground">{t('noDirectPermissions')}</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <PermissionTreeView
                        permissions={directPermissions}
                        variant="direct"
                        showHeaders
                      />

                      {/* Remove Actions Section */}
                      <div className="space-y-2 pt-2 border-t border-border">
                        <p className={HEADING_ROLE_CLASSES.eyebrow}>{t('removePermissions')}</p>
                        <div className="grid grid-cols-1 gap-2">
                          {directPermissions.map((permission) => (
                            <div
                              key={permission}
                              className="flex items-center justify-between rounded-md border border-border p-2 bg-muted"
                              data-testid={`direct-permission-${permission}`}
                            >
                              <code dir="ltr" className="text-xs font-mono text-foreground">
                                {permission}
                              </code>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleRemovePermission(permission)}
                                disabled={isRemoving}
                                className="h-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                data-testid={`remove-permission-${permission}`}
                              >
                                <Trash2 className="h-3 w-3 me-1" />
                                {t('remove')}
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Permission Search Dialog */}
      <PermissionSearchDialog
        open={searchDialogOpen}
        onOpenChange={setSearchDialogOpen}
        selectedPermissions={selectedPermissions}
        onChange={setSelectedPermissions}
        excludedPermissions={effectivePermissions}
        isLoading={isAdding}
        onConfirm={handleAddPermissions}
      />
    </>
  );
}
