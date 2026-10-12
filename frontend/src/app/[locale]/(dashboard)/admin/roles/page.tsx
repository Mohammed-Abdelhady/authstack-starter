'use client';

import { useState, useMemo, useCallback, useRef, Activity } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Description, Heading, SearchBar, SplitView } from '@/components/design-system';
import { PaginationControl } from '@/components/pagination';
import { useListRolesQuery } from '@/modules/roles/api/rolesApi';
import type { Role } from '@/modules/roles/types';
import { RoleSidebarNav } from '@/modules/permissions/components/roles/RoleSidebarNav';
import { RoleDetailPanel } from '@/modules/permissions/components/roles/RoleDetailPanel';
import { RoleSplitViewSkeleton, RoleDialogs } from '@/modules/roles/components';
import { RoutePermissionGuard } from '@/modules/permissions';
import { FREE_TEXT_SEARCH_CLASSES } from '@/modules/permissions/constants/freeText';
import { MAX_ADMIN_SEARCH_LENGTH } from '@/modules/permissions/constants/search';
import { ROLE_PERMISSIONS } from '@app/core';
import { ListLoadError, StaleListNotice } from '@/components/layout/ListReadFailure';
import { useListReadState } from '@/hooks/useListReadState';
import { Plus, Shield } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';

export default function RolesPage() {
  const t = useTranslations('roles');
  const tCommon = useTranslations('common');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [roleToEdit, setRoleToEdit] = useState<Role | null>(null);

  const debouncedSearch = useDebounce(searchTerm, 300);
  // Takes focus once a role is deleted: its delete button then stands for another role.
  const titleRef = useRef<HTMLHeadingElement>(null);

  const listParams = {
    page,
    limit: 20,
    search: debouncedSearch.trim() || undefined,
  };
  const { data, currentData, isLoading, isFetching, error, refetch } =
    useListRolesQuery(listParams);

  const lastAvailablePage = Math.max(1, currentData?.totalPages ?? page);
  const hasSettledCurrentPage = currentData?.page === page && !isFetching && error === undefined;
  if (hasSettledCurrentPage && page > lastAvailablePage) setPage(lastAvailablePage);

  // A list already on screen stays when a later read of it fails.
  const { showSkeleton, showLoadError, isStale, retry } = useListReadState({
    isLoading,
    error,
    hasData: currentData !== undefined,
    refetch,
    landing: titleRef,
  });

  const roles = useMemo(() => data?.roles || [], [data?.roles]);
  const totalPages = data?.totalPages || 1;
  const totalCount = data?.total ?? roles.length;

  const effectiveSelectedRoleId = roles.some((role) => role.id === selectedRoleId)
    ? selectedRoleId
    : (roles[0]?.id ?? null);

  const selectedRole = useMemo(
    () => roles.find((r) => r.id === effectiveSelectedRoleId) || null,
    [roles, effectiveSelectedRoleId],
  );

  const handleSelectRole = useCallback((roleId: string) => {
    setSelectedRoleId(roleId);
  }, []);

  const handleEdit = useCallback((role: Role) => {
    setRoleToEdit(role);
    setEditDialogOpen(true);
  }, []);

  const handleDelete = useCallback((role: Role) => {
    setRoleToEdit(role);
    setDeleteDialogOpen(true);
  }, []);

  const handleSuccess = useCallback(() => {
    refetch();
  }, [refetch]);

  const isFiltered = Boolean(debouncedSearch.trim());

  return (
    <RoutePermissionGuard permission={ROLE_PERMISSIONS.LIST_ALL}>
      <div className="container max-w-7xl py-8 px-4" data-testid="admin-roles-page">
        {/* Header */}
        <div className="my-8">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
            <div>
              <Heading level={1} variant="pageTitle" ref={titleRef} tabIndex={-1}>
                {t('title')}
              </Heading>
              <Description className="mt-1" role="status">
                {t('count', { count: totalCount })}
              </Description>
            </div>
            <Button onClick={() => setCreateDialogOpen(true)} data-testid="create-role-button">
              <Plus className="me-2 h-4 w-4" aria-hidden="true" />
              {t('createRole')}
            </Button>
          </div>

          <SearchBar
            className={FREE_TEXT_SEARCH_CLASSES}
            aria-label={t('searchLabel')}
            placeholder={t('searchPlaceholder')}
            maxLength={MAX_ADMIN_SEARCH_LENGTH}
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value.slice(0, MAX_ADMIN_SEARCH_LENGTH));
              setPage(1);
            }}
            onClear={() => {
              setSearchTerm('');
              setPage(1);
            }}
            showClear={searchTerm.length > 0}
            data-testid="search-roles-input"
          />
        </div>

        {/* State 1: Skeleton Loading */}
        <Activity mode={showSkeleton ? 'visible' : 'hidden'}>
          <RoleSplitViewSkeleton />
        </Activity>

        {/* State 2: Error, nothing loaded for this view */}
        <Activity mode={showLoadError ? 'visible' : 'hidden'}>
          <ListLoadError
            error={error}
            onRetry={retry}
            isRetrying={isFetching}
            retryTestId="retry-roles-button"
          >
            {t('loadError')}
          </ListLoadError>
        </Activity>

        {isStale && (
          <StaleListNotice
            error={error}
            onRetry={retry}
            isRetrying={isFetching}
            retryTestId="retry-refresh-roles-button"
          />
        )}

        {/* State 3: Empty */}
        <Activity
          mode={!showSkeleton && !showLoadError && roles.length === 0 ? 'visible' : 'hidden'}
        >
          <div
            className="flex flex-col items-center justify-center py-16 text-center"
            data-testid="empty-state"
          >
            <Shield className="h-10 w-10 text-muted-foreground mb-3" aria-hidden="true" />
            <Heading level={2} variant="sectionTitle">
              {isFiltered ? t('noRoles') : t('noRolesYet')}
            </Heading>
            <Description className="max-w-sm mt-1 mb-4">
              {isFiltered ? t('noRolesHint') : t('noRolesYetHint')}
            </Description>
            {isFiltered ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchTerm('');
                  setPage(1);
                }}
                data-testid="clear-role-search-button"
              >
                {tCommon('clearSearch')}
              </Button>
            ) : (
              <Button
                onClick={() => setCreateDialogOpen(true)}
                data-testid="create-first-role-button"
              >
                <Plus className="me-2 h-4 w-4" aria-hidden="true" />
                {t('createRole')}
              </Button>
            )}
          </div>
        </Activity>

        {/* State 4: Data */}
        <Activity mode={!showSkeleton && !showLoadError && roles.length > 0 ? 'visible' : 'hidden'}>
          <div className="space-y-6">
            <SplitView
              sidebar={
                <RoleSidebarNav
                  roles={roles}
                  selectedRoleId={effectiveSelectedRoleId}
                  onSelectRole={handleSelectRole}
                />
              }
              content={
                <RoleDetailPanel role={selectedRole} onEdit={handleEdit} onDelete={handleDelete} />
              }
              sidebarLabel={t('title')}
              sidebarWidth="280px"
              stickySidebar
            />

            <PaginationControl
              currentPage={page}
              totalPages={totalPages}
              onPageChange={setPage}
              isLoading={isLoading || isFetching}
            />
          </div>
        </Activity>

        {/* Dialogs */}
        <RoleDialogs
          createOpen={createDialogOpen}
          onCreateOpenChange={setCreateDialogOpen}
          editOpen={editDialogOpen}
          onEditOpenChange={setEditDialogOpen}
          deleteOpen={deleteDialogOpen}
          onDeleteOpenChange={setDeleteDialogOpen}
          roleToEdit={roleToEdit}
          onSuccess={handleSuccess}
          deleteLanding={titleRef}
        />
      </div>
    </RoutePermissionGuard>
  );
}
