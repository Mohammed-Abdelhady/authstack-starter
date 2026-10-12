'use client';

import { HEADING_ROLE_CLASSES } from '@/constants/typography';
import { Heading } from '@/components/design-system';
import { useRef, useState } from 'react';
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
import { showsOwnRefusal } from '@/lib/refusal';
import { useDialogRefusal } from '@/hooks/useFormRefusal';
import { FormRootError } from '@/components/forms';
import { WRAP_ANYWHERE_CLASSES } from '@/constants/textWrap';
import { cn } from '@/lib/utils';

const SERVER_ERROR_STATUS_MIN = 500;

function outcomeUnknown(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) return true;
  return typeof error.status !== 'number' || error.status >= SERVER_ERROR_STATUS_MIN;
}

export interface UserPermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  userName?: string;
  /** Runs when the dialog has closed, to put focus back on what opened it */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Dialog for viewing inherited and managing direct user permissions.
 */
export function UserPermissionsDialog({
  open,
  onOpenChange,
  userId,
  userName,
  onCloseAutoFocus,
}: UserPermissionsDialogProps) {
  const t = useTranslations('permissions.dialog');
  const tCommon = useTranslations('common');
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

  const [addPermission] = useAddPermissionMutation();
  const [removePermission] = useRemovePermissionMutation();
  // One flag for the whole run of additions: the store's own drops between two of them.
  const [isAdding, setIsAdding] = useState(false);
  const addingPermissions = useRef(false);
  // The permission being removed, so only its own button says so.
  const [removing, setRemoving] = useState<string | null>(null);
  const removingPermission = useRef<string | null>(null);
  const isRemoving = removing !== null;
  const addRefusal = useDialogRefusal();
  const removeRefusal = useDialogRefusal();
  const directHeadingRef = useRef<HTMLHeadingElement>(null);

  const handleAddPermissions = async () => {
    if (!userId || availablePermissions.length === 0 || addingPermissions.current) return;

    addingPermissions.current = true;
    addRefusal.clear();
    setIsAdding(true);
    let acceptedCount = 0;
    try {
      // Add permissions one by one
      for (const permission of availablePermissions) {
        await showsOwnRefusal(addPermission({ userId, permission })).unwrap();
        acceptedCount += 1;
      }

      toast.success(t('addSuccess', { count: availablePermissions.length }));

      // Reset state
      setSelectedPermissions([]);
      setSearchDialogOpen(false);
    } catch (error) {
      if (acceptedCount > 0 || outcomeUnknown(error)) await refetch();
      addRefusal.show(error);
      reportUnlessHandled(error);
    } finally {
      addingPermissions.current = false;
      setIsAdding(false);
    }
  };

  const handleRemovePermission = async (permission: string) => {
    if (!userId || removingPermission.current !== null) return;

    removingPermission.current = permission;
    removeRefusal.clear();
    setRemoving(permission);
    try {
      await showsOwnRefusal(removePermission({ userId, permission })).unwrap();

      toast.success(t('removeSuccess'));
      // The row and its button leave with the permission.
      directHeadingRef.current?.focus();
    } catch (error) {
      if (outcomeUnknown(error)) await refetch();
      removeRefusal.show(error);
      reportUnlessHandled(error);
    } finally {
      removingPermission.current = null;
      setRemoving(null);
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
      <Dialog key={userId || 'no-user'} open={open} busy={isRemoving} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-h-[90vh] max-w-3xl overflow-y-auto"
          data-testid="user-permissions-dialog"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>
              {userName ? t('descriptionWithUser', { name: userName }) : t('descriptionGeneric')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-6">
            {isLoading || isLoadingRole ? (
              <div className="flex items-center justify-center py-12" role="status">
                <Loader2
                  className="h-8 w-8 motion-safe:animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="sr-only">{tCommon('loading')}</span>
              </div>
            ) : (
              <>
                <UserPermissionsSummary
                  role={data?.role}
                  roleName={roleData?.name}
                  totalCount={effectivePermissions.length}
                  inheritedCount={inheritedPermissions.length}
                  directCount={directPermissions.length}
                  hasWildcard={hasWildcard}
                  t={t}
                />

                {/* Inherited Permissions (Read-only) - Tree View */}
                <div className="space-y-3">
                  {/* The badge moves to a line of its own before it is cut. */}
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <Shield className="h-4 w-4 shrink-0 text-info" />
                      <Heading level={3} variant="subsectionTitle" data-testid="inherited-heading">
                        {t('inheritedFromRole', { role: data?.role || '' })}
                      </Heading>
                    </div>
                    {data?.role && (
                      <Badge
                        dir="ltr"
                        variant="secondary"
                        className="block min-w-0 truncate text-xs"
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
                      <User className="h-4 w-4 text-status-success" />
                      <Heading
                        level={3}
                        variant="subsectionTitle"
                        ref={directHeadingRef}
                        tabIndex={-1}
                      >
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
                        <FormRootError
                          error={removeRefusal.alert}
                          className="mb-0"
                          testId="remove-permission-error"
                        />
                        <div className="grid grid-cols-1 gap-2">
                          {directPermissions.map((permission) => (
                            <div
                              key={permission}
                              className="flex items-center justify-between rounded-md border border-border p-2 bg-muted"
                              data-testid={`direct-permission-${permission}`}
                            >
                              <code
                                dir="ltr"
                                className={cn(
                                  'text-xs font-mono text-foreground',
                                  WRAP_ANYWHERE_CLASSES,
                                )}
                              >
                                {permission}
                              </code>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleRemovePermission(permission)}
                                busy={isRemoving}
                                aria-busy={removing === permission}
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
        onOpenChange={(next) => {
          if (!next) addRefusal.clear();
          setSearchDialogOpen(next);
        }}
        refusal={addRefusal.alert}
        selectedPermissions={selectedPermissions}
        onChange={setSelectedPermissions}
        excludedPermissions={effectivePermissions}
        isLoading={isAdding}
        onConfirm={handleAddPermissions}
      />
    </>
  );
}
