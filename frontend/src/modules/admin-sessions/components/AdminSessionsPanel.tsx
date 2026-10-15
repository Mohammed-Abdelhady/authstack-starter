'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SESSION_PERMISSIONS } from '@app/core';
import { Description, Heading } from '@/components/design-system';
import { Button } from '@/components/ui/button';
import { LoadingRegion } from '@/components/layout/LoadingRegion';
import { ListLoadError } from '@/components/layout/ListReadFailure';
import { RoutePermissionGuard, usePermission } from '@/modules/permissions';
import { useAppSelector } from '@/store/hooks';
import { useGetAdminSessionsQuery } from '../api/adminSessionsApi';
import type {
  AdminSession,
  AdminSessionScope,
  SessionEndTarget,
} from '../types/admin-session.types';
import { AdminSessionRow } from './AdminSessionRow';
import { EndAdminSessionsDialog } from './EndAdminSessionsDialog';

interface Props {
  userId: string;
}

function SessionsContent({ scope }: { scope: AdminSessionScope }) {
  const t = useTranslations('adminSessions');
  const { can } = usePermission();
  const [target, setTarget] = useState<SessionEndTarget | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [ended, setEnded] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const { currentData, isFetching, error, refetch } = useGetAdminSessionsQuery(scope);
  const sessions = currentData?.sessions ?? [];
  const ready = currentData !== undefined && !isFetching && !error;
  const canEnd = can(SESSION_PERMISSIONS.DELETE_ALL) && ready && !needsReview;
  const selectedId = target && 'session' in target ? target.session.id : null;
  const canConfirm =
    canEnd &&
    target !== null &&
    ('all' in target ? sessions.length > 0 : sessions.some((session) => session.id === selectedId));
  const endOne = useCallback((session: AdminSession) => {
    setEnded(false);
    setTarget({ session });
  }, []);
  const endAll = useCallback(() => {
    setEnded(false);
    setTarget({ all: true });
  }, []);
  const close = useCallback(() => setTarget(null), []);
  const succeeded = useCallback(() => {
    setTarget(null);
    setEnded(true);
  }, []);
  const unknown = useCallback(() => setNeedsReview(true), []);
  const refresh = useCallback(() => {
    void refetch().then((result) => {
      if (result.data && !result.error) setNeedsReview(false);
    });
  }, [refetch]);

  return (
    <section className="space-y-4" data-testid="admin-sessions-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Heading ref={heading} tabIndex={-1} level={2} variant="sectionTitle">
            {t('title')}
          </Heading>
          <Description>{t('description', { user: scope.userId })}</Description>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={refresh}
            busy={isFetching}
            data-testid="admin-sessions-refresh"
          >
            {t('refresh')}
          </Button>
          {can(SESSION_PERMISSIONS.DELETE_ALL) && canEnd && sessions.length > 0 && (
            <Button variant="destructive" onClick={endAll} data-testid="admin-sessions-end-all">
              {t('endAll')}
            </Button>
          )}
        </div>
      </div>
      {ended && (
        <p role="status" className="text-sm">
          {t('ended')}
        </p>
      )}
      {needsReview && (
        <p role="alert" className="text-sm">
          {t('reviewBeforeRetry')}
        </p>
      )}
      {isFetching ? (
        <LoadingRegion label={t('loading')} rows={2} />
      ) : error ? (
        <ListLoadError error={error} onRetry={refresh} retryTestId="admin-sessions-retry">
          {t('loadError')}
        </ListLoadError>
      ) : currentData ? (
        <div className="space-y-4">
          {sessions.length === 0 && <Description>{t('empty')}</Description>}
          {sessions.map((session) => (
            <AdminSessionRow key={session.id} session={session} canEnd={canEnd} onEnd={endOne} />
          ))}
        </div>
      ) : null}
      {target && (
        <EndAdminSessionsDialog
          scope={scope}
          target={target}
          canConfirm={canConfirm}
          onClose={close}
          onSuccess={succeeded}
          onUnknown={unknown}
          landing={heading}
        />
      )}
    </section>
  );
}

export function AdminSessionsPanel({ userId }: Props) {
  const auth = useAppSelector((state) => state.auth);
  const t = useTranslations('adminSessions');
  const self = auth.user?.id.toLowerCase() === userId.toLowerCase();
  return (
    <RoutePermissionGuard permission={SESSION_PERMISSIONS.READ_ALL}>
      {self ? (
        <Description>{t('selfRefused')}</Description>
      ) : auth.user && userId ? (
        <SessionsContent
          key={`${auth.user.id}:${auth.sessionGeneration}:${userId}`}
          scope={{ userId, actorId: auth.user.id, sessionGeneration: auth.sessionGeneration }}
        />
      ) : null}
    </RoutePermissionGuard>
  );
}
