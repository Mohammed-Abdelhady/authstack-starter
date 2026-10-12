'use client';

import { Description, Heading } from '@/components/design-system';
import { useState, useMemo, useCallback, useEffect, useRef, lazy, Suspense, Activity } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingRegion } from '@/components/layout/LoadingRegion';
import { PaginationControl } from '@/components/pagination';
import { useGetUsersQuery } from '@/modules/users/api/usersApi';
import { UserListSkeleton, UserListToolbar, UserGroupedList } from '@/modules/users/components';
import { CreateUserButton } from '@/modules/permissions/components/users/CreateUserButton';
import { PermissionGuard, RoutePermissionGuard } from '@/modules/permissions';
import { USER_PERMISSIONS } from '@app/core';
import { ListLoadError, StaleListNotice } from '@/components/layout/ListReadFailure';
import { useListReadState } from '@/hooks/useListReadState';
import { useDebounce } from '@/hooks/useDebounce';
import { useReturnFocus } from '@/hooks/useReturnFocus';
import { useAppDispatch } from '@/store/hooks';
import { baseApi } from '@/store/api/baseApi';

const UserPermissionsDialog = lazy(() =>
  import('@/modules/permissions/components/users/UserPermissionsDialog').then((mod) => ({
    default: mod.UserPermissionsDialog,
  })),
);

export default function AdminUsersPage() {
  const t = useTranslations('users');
  const tCommon = useTranslations('common');
  const dispatch = useAppDispatch();
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserName, setSelectedUserName] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [shouldAnimate, setShouldAnimate] = useState(true);

  const debouncedSearch = useDebounce(searchQuery, 300);

  useEffect(() => {
    const timer = setTimeout(() => setShouldAnimate(false), 600);
    return () => clearTimeout(timer);
  }, []);

  const listParams = {
    page,
    limit: 20,
    search: debouncedSearch.trim() || undefined,
    role: roleFilter !== 'all' ? roleFilter : undefined,
  };
  const { currentData, isLoading, isFetching, error, refetch } = useGetUsersQuery(listParams);
  const isSearchDebouncing = searchQuery.trim() !== debouncedSearch.trim();
  const visibleData = isSearchDebouncing ? undefined : currentData;

  const lastAvailablePage = Math.max(1, currentData?.totalPages ?? page);
  const hasSettledCurrentPage = currentData?.page === page && !isFetching && error === undefined;
  if (hasSettledCurrentPage && page > lastAvailablePage) setPage(lastAvailablePage);

  const titleRef = useRef<HTMLHeadingElement>(null);
  // A list already on screen stays when a later read of it fails.
  const { showSkeleton, showLoadError, isStale, retry } = useListReadState({
    isLoading: isLoading || isSearchDebouncing || (isFetching && visibleData === undefined),
    error: isSearchDebouncing ? undefined : error,
    hasData: visibleData !== undefined,
    refetch,
    landing: titleRef,
  });

  const users = useMemo(() => visibleData?.users || [], [visibleData?.users]);
  const totalPages = visibleData?.totalPages || 1;
  const totalCount = visibleData?.total ?? users.length;

  const verifiedUsers = useMemo(() => users.filter((u) => u.isVerified), [users]);
  const pendingUsers = useMemo(() => users.filter((u) => !u.isVerified), [users]);

  // The menu button the permissions dialog was opened from, to return focus to.
  const [permissionsOpenerRef, returnFocusToOpener] = useReturnFocus();
  const handleManagePermissions = useCallback(
    (userId: string, opener: HTMLElement | null, userName: string) => {
      permissionsOpenerRef.current = opener;
      setSelectedUserId(userId);
      setSelectedUserName(userName);
    },
    [permissionsOpenerRef],
  );

  const handleClosePermissionsDialog = useCallback((open: boolean) => {
    if (!open) {
      setSelectedUserId(null);
      setSelectedUserName(null);
    }
  }, []);

  const toggleSection = useCallback((sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }, []);

  const handleRefresh = useCallback(() => {
    dispatch(baseApi.util.invalidateTags(['User']));
    refetch();
  }, [dispatch, refetch]);

  const handleClearFilters = useCallback(() => {
    setSearchQuery('');
    setRoleFilter('all');
    setPage(1);
  }, []);

  const isFiltered = Boolean(debouncedSearch.trim()) || roleFilter !== 'all';

  return (
    <RoutePermissionGuard permission={USER_PERMISSIONS.LIST_ALL}>
      <div className="container max-w-7xl py-8 px-4" data-testid="admin-users-page">
        {/* Header */}
        <div className="my-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <Heading level={1} variant="pageTitle" ref={titleRef} tabIndex={-1}>
                {t('title')}
              </Heading>
              <Description className="mt-1" role="status">
                {t('count', { count: totalCount })}
              </Description>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                busy={isLoading || isFetching}
                aria-busy={isLoading || isFetching}
                data-testid="refresh-users-button"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={`h-4 w-4 me-2 ${isLoading || isFetching ? 'motion-safe:animate-spin' : ''}`}
                />
                {t('refresh')}
              </Button>
              <PermissionGuard permission={USER_PERMISSIONS.CREATE_ALL}>
                <CreateUserButton />
              </PermissionGuard>
            </div>
          </div>
        </div>

        {/* Search & Filters */}
        <UserListToolbar
          searchQuery={searchQuery}
          onSearchChange={(val) => {
            setSearchQuery(val);
            setPage(1);
          }}
          onSearchClear={() => {
            setSearchQuery('');
            setPage(1);
          }}
          roleFilter={roleFilter}
          onRoleFilterChange={(role) => {
            setRoleFilter(role);
            setPage(1);
          }}
        />

        {/* State 1: Skeleton Loading */}
        <Activity mode={showSkeleton ? 'visible' : 'hidden'}>
          <UserListSkeleton label={t('loading')} />
        </Activity>

        {/* State 2: Error, nothing loaded for this view */}
        <Activity mode={showLoadError ? 'visible' : 'hidden'}>
          <ListLoadError
            error={error}
            onRetry={retry}
            isRetrying={isFetching}
            retryTestId="retry-users-button"
          >
            {t('loadError')}
          </ListLoadError>
        </Activity>

        {isStale && (
          <StaleListNotice
            error={error}
            onRetry={retry}
            isRetrying={isFetching}
            retryTestId="retry-refresh-users-button"
          />
        )}

        {/* State 3: Empty */}
        <Activity
          mode={!showSkeleton && !showLoadError && users.length === 0 ? 'visible' : 'hidden'}
        >
          <div
            className="flex flex-col items-center justify-center py-12 text-center"
            data-testid="empty-state"
          >
            <Users className="h-10 w-10 text-muted-foreground mb-3" aria-hidden="true" />
            <Heading level={2} variant="sectionTitle">
              {isFiltered ? t('noUsers') : t('noUsersYet')}
            </Heading>
            <Description className="max-w-sm mt-1 mb-4">
              {isFiltered ? t('noUsersHint') : t('noUsersYetHint')}
            </Description>
            {isFiltered ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearFilters}
                data-testid="clear-filters-button"
              >
                {tCommon('clearSearch')}
              </Button>
            ) : (
              <PermissionGuard permission={USER_PERMISSIONS.CREATE_ALL}>
                <CreateUserButton />
              </PermissionGuard>
            )}
          </div>
        </Activity>

        {/* State 4: Data */}
        <Activity mode={!showSkeleton && !showLoadError && users.length > 0 ? 'visible' : 'hidden'}>
          <UserGroupedList
            verifiedUsers={verifiedUsers}
            pendingUsers={pendingUsers}
            collapsedSections={collapsedSections}
            onToggleSection={toggleSection}
            shouldAnimate={shouldAnimate}
            onManagePermissions={handleManagePermissions}
          />

          <PaginationControl
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
            isLoading={isLoading || isFetching}
          />

          <div className="mt-2 text-xs text-tertiary" role="status">
            {t('showingCount', { filtered: users.length, total: totalCount })}
          </div>
        </Activity>

        {/* User Permissions Dialog */}
        <Activity mode={selectedUserId ? 'visible' : 'hidden'}>
          <Suspense
            fallback={<LoadingRegion label={tCommon('loading')} rows={2} testId="dialog-loading" />}
          >
            <UserPermissionsDialog
              userId={selectedUserId || ''}
              userName={selectedUserName ?? undefined}
              open={!!selectedUserId}
              onOpenChange={handleClosePermissionsDialog}
              onCloseAutoFocus={returnFocusToOpener}
            />
          </Suspense>
        </Activity>
      </div>
    </RoutePermissionGuard>
  );
}
