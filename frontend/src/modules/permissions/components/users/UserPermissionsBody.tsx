import { HEADING_ROLE_CLASSES } from '@/constants/typography';
import { Heading } from '@/components/design-system';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PermissionTreeView } from '../permission-tree/PermissionTreeView';
import { UserPermissionsSummary } from './UserPermissionsSummary';
import { Loader2, Plus, Trash2, Shield, User } from 'lucide-react';
import { FormRootError } from '@/components/forms';
import { WRAP_ANYWHERE_CLASSES } from '@/constants/textWrap';
import { cn } from '@/lib/utils';
import type { useUserPermissionsDialog } from '../../hooks/useUserPermissionsDialog';

type Model = ReturnType<typeof useUserPermissionsDialog>;

function InheritedPermissions({ model }: { model: Model }) {
  const { t, data, inheritedPermissions } = model;
  return (
    <>
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
          <PermissionTreeView permissions={inheritedPermissions} variant="inherited" showHeaders />
        )}
      </div>
    </>
  );
}

function DirectPermissionRows({ model }: { model: Model }) {
  const {
    t,
    directPermissions,
    mutations,
    unavailable,
    prerequisiteUnavailable,
    controlsBusy,
    removing,
  } = model;
  return (
    <>
      {directPermissions.map((permission) => (
        <div
          key={permission}
          className="flex items-center justify-between rounded-md border border-border p-2 bg-muted"
          data-testid={`direct-permission-${permission}`}
        >
          <code
            dir="ltr"
            className={cn('text-xs font-mono text-foreground', WRAP_ANYWHERE_CLASSES)}
          >
            {permission}
          </code>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (!unavailable) void mutations.remove(permission);
            }}
            busy={controlsBusy}
            disabled={prerequisiteUnavailable}
            aria-label={t('removePermission', { permission })}
            aria-busy={removing === permission}
            className="h-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
            data-testid={`remove-permission-${permission}`}
          >
            <Trash2 className="h-3 w-3 me-1" />
            {t('remove')}
          </Button>
        </div>
      ))}{' '}
    </>
  );
}

function DirectPermissions({ model }: { model: Model }) {
  const {
    t,
    directHeadingRef,
    directPermissions,
    mutations,
    unavailable,
    prerequisiteUnavailable,
    controlsBusy,
    setSearchDialogOpen,
    removeRefusal,
  } = model;
  return (
    <>
      {/* Direct Permissions (Editable) - Tree View with Remove Actions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-status-success" />
            <Heading level={3} variant="subsectionTitle" ref={directHeadingRef} tabIndex={-1}>
              {t('directPermissions', { count: directPermissions.length })}
            </Heading>
          </div>
          <Button
            size="sm"
            onClick={() => {
              if (!unavailable && !mutations.busy) setSearchDialogOpen(true);
            }}
            busy={controlsBusy}
            disabled={prerequisiteUnavailable}
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
            <PermissionTreeView permissions={directPermissions} variant="direct" showHeaders />

            {/* Remove Actions Section */}
            <div className="space-y-2 pt-2 border-t border-border">
              <p className={HEADING_ROLE_CLASSES.eyebrow}>{t('removePermissions')}</p>
              <FormRootError
                error={removeRefusal.alert}
                className="mb-0"
                testId="remove-permission-error"
              />
              <div className="grid grid-cols-1 gap-2">
                <DirectPermissionRows model={model} />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export function UserPermissionsBody({ model }: { model: Model }) {
  const {
    t,
    tCommon,
    data,
    roleData,
    isLoading,
    isLoadingRole,
    isFetching,
    readError,
    directPermissions,
    inheritedPermissions,
    effectivePermissions,
    hasWildcard,
  } = model;
  if (isLoading || isLoadingRole || (!data && isFetching))
    return (
      <div className="flex items-center justify-center py-12" role="status">
        <Loader2
          className="h-8 w-8 motion-safe:animate-spin text-muted-foreground"
          aria-hidden="true"
        />
        <span className="sr-only">{tCommon('loading')}</span>
      </div>
    );
  if (readError || !data) return null;
  return (
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

      <InheritedPermissions model={model} />
      <DirectPermissions model={model} />
    </>
  );
}
