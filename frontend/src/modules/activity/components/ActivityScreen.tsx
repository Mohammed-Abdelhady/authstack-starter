'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Description, Heading } from '@/components/design-system';
import { Button } from '@/components/ui/button';
import { LoadingRegion } from '@/components/layout/LoadingRegion';
import { ListLoadError } from '@/components/layout/ListReadFailure';
import { FormRootError } from '@/components/forms';
import { httpStatusOf, type RequestError } from '@/lib/refusal';
import { PaginationControl } from '@/components/pagination';
import { RoutePermissionGuard } from '@/modules/permissions';
import { useAppSelector } from '@/store/hooks';
import { useGetAdminActivityQuery } from '../api/activityApi';
import {
  ACTIVITY_BAD_REQUEST_STATUS,
  ACTIVITY_PAGE_LIMIT,
  ACTIVITY_READ_PERMISSION,
} from '../constants/activity';
import type { ActivityFilters as Filters } from '../types/activity.types';
import { ActivityFilters } from './ActivityFilters';
import { ActivityRow } from './ActivityRow';
import { activityPageCount } from '../utils/activityPageCount';

interface Props {
  actorId: string;
  sessionGeneration: number;
}

function ActivityContent({ actorId, sessionGeneration }: Props) {
  const t = useTranslations('activity');
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const heading = useRef<HTMLHeadingElement>(null);
  const { currentData, isFetching, error, refetch } = useGetAdminActivityQuery({
    ...filters,
    page,
    limit: ACTIVITY_PAGE_LIMIT,
    actorId,
    sessionGeneration,
  });
  const lastAvailablePage = activityPageCount(
    currentData?.pagination.totalPages ?? page,
    ACTIVITY_PAGE_LIMIT,
  );
  const invalidInput =
    error !== undefined &&
    'status' in error &&
    httpStatusOf(error as RequestError) === ACTIVITY_BAD_REQUEST_STATUS;
  const settledCurrentPage =
    currentData?.pagination.page === page && !isFetching && error === undefined;
  if (settledCurrentPage && page > lastAvailablePage) setPage(lastAvailablePage);

  const applyFilters = useCallback((next: Filters) => {
    setFilters(next);
    setPage(1);
  }, []);
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  const changePage = useCallback((next: number) => {
    setPage(activityPageCount(next, ACTIVITY_PAGE_LIMIT));
    heading.current?.focus();
  }, []);

  return (
    <div className="container max-w-7xl space-y-6 px-4 py-8" data-testid="activity-screen">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Heading ref={heading} tabIndex={-1} level={1} variant="pageTitle">
            {t('title')}
          </Heading>
          <Description className="mt-1">{t('description')}</Description>
        </div>
        <Button
          variant="outline"
          onClick={refresh}
          busy={isFetching}
          data-testid="activity-refresh"
        >
          {t('refresh')}
        </Button>
      </div>
      <ActivityFilters onApply={applyFilters} busy={isFetching} />
      {isFetching ? (
        <LoadingRegion label={t('loading')} rows={3} />
      ) : invalidInput ? (
        <FormRootError error={t('invalidInput')} testId="activity-invalid-input" />
      ) : error ? (
        <ListLoadError error={error} onRetry={refresh} retryTestId="activity-retry">
          {t('loadError')}
        </ListLoadError>
      ) : currentData ? (
        <section aria-label={t('results')} className="space-y-4">
          <p role="status" className="text-sm text-muted-foreground">
            {t('count', { count: currentData.pagination.total })}
          </p>
          {currentData.data.length === 0 ? (
            <Description>{t('empty')}</Description>
          ) : (
            currentData.data.map((event) => <ActivityRow key={event.id} event={event} />)
          )}
          <PaginationControl
            currentPage={page}
            totalPages={lastAvailablePage}
            onPageChange={changePage}
            isLoading={isFetching}
          />
        </section>
      ) : null}
    </div>
  );
}

export function ActivityScreen() {
  const auth = useAppSelector((state) => state.auth);
  return (
    <RoutePermissionGuard permission={ACTIVITY_READ_PERMISSION}>
      {auth.user && (
        <ActivityContent
          key={`${auth.user.id}:${auth.sessionGeneration}`}
          actorId={auth.user.id}
          sessionGeneration={auth.sessionGeneration}
        />
      )}
    </RoutePermissionGuard>
  );
}
