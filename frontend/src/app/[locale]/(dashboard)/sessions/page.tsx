'use client';

import { useState, useEffect, useRef, Activity } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCw, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ListLoadError, StaleListNotice } from '@/components/layout/ListReadFailure';
import { useListReadState } from '@/hooks/useListReadState';
import { Description, Heading, TimelineList } from '@/components/design-system';
import {
  SessionCardTimeline,
  SessionSignOutDialog,
  RevokeAllSessionsButton,
  useSignOutTarget,
  SessionTimelineSkeleton,
} from '@/modules/sessions';
import { useGetSessionsQuery } from '@/modules/sessions';

/**
 * Sessions management page - Redesigned with timeline view
 * Displays all active sessions with device info and logout actions
 * Accessible at /[locale]/sessions
 */
export default function SessionsPage() {
  const t = useTranslations('sessions');
  const [shouldAnimate, setShouldAnimate] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShouldAnimate(false);
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  const {
    data: sessions,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useGetSessionsQuery(undefined, {
    pollingInterval: 30000, // Auto-refresh every 30 seconds
  });

  // Takes focus once a session is signed out: its button leaves with it.
  const titleRef = useRef<HTMLHeadingElement>(null);
  // A list already on screen stays when a later read of it fails.
  const { showSkeleton, showLoadError, isStale, retry } = useListReadState({
    isLoading,
    error,
    hasData: sessions !== undefined,
    refetch,
    landing: titleRef,
  });

  const otherSessionsCount = sessions?.filter((s) => !s.isCurrent).length || 0;
  const currentSessionIndex = sessions?.findIndex((s) => s.isCurrent) ?? -1;
  const signOut = useSignOutTarget();

  return (
    <div className="container max-w-4xl py-8 px-4" data-testid="sessions-page">
      {/* Header */}
      <div className="my-8 ">
        <div className="flex items-center justify-between flex-wrap gap-4 mb-2">
          <div>
            <Heading level={1} variant="pageTitle" ref={titleRef} tabIndex={-1}>
              {t('title')}
            </Heading>
            <Description className="mt-1">{t('description')}</Description>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              busy={isLoading}
              aria-busy={isLoading}
              data-testid="refresh-sessions-button"
            >
              <RefreshCw
                aria-hidden="true"
                className={`h-4 w-4 me-2 ${isLoading ? 'motion-safe:animate-spin' : ''}`}
              />
              {t('refresh')}
            </Button>
            <RevokeAllSessionsButton otherSessionsCount={otherSessionsCount} landing={titleRef} />
          </div>
        </div>

        <Alert
          variant="warningSoft"
          role="note"
          className="mt-4"
          data-testid="sessions-security-note"
        >
          <Shield className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>{t('securityWarning')}</AlertDescription>
        </Alert>
      </div>

      {/* Loading State */}
      <Activity mode={showSkeleton ? 'visible' : 'hidden'}>
        <SessionTimelineSkeleton />
      </Activity>

      {/* Error State: nothing was ever loaded */}
      <Activity mode={showLoadError ? 'visible' : 'hidden'}>
        <ListLoadError
          error={error}
          onRetry={retry}
          isRetrying={isFetching}
          retryTestId="retry-sessions-button"
        >
          {t('loadError')}
        </ListLoadError>
      </Activity>

      {isStale && (
        <StaleListNotice
          error={error}
          onRetry={retry}
          isRetrying={isFetching}
          retryTestId="retry-refresh-sessions-button"
        />
      )}

      {/* Empty State */}
      <Activity
        mode={!showSkeleton && !showLoadError && sessions?.length === 0 ? 'visible' : 'hidden'}
      >
        <div
          className="flex flex-col items-center justify-center py-12 text-center"
          data-testid="empty-state"
        >
          <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-3" aria-hidden="true" />
          <Heading level={2} variant="sectionTitle">
            {t('noSessions')}
          </Heading>
          <Description className="max-w-sm mt-1 mb-4">{t('noSessionsDescription')}</Description>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            data-testid="refresh-empty-sessions-button"
          >
            <RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />
            {t('refresh')}
          </Button>
        </div>
      </Activity>

      {/* Sessions Timeline */}
      <Activity
        mode={
          !showSkeleton && !showLoadError && sessions && sessions.length > 0 ? 'visible' : 'hidden'
        }
      >
        <section aria-labelledby="sessions-list-heading" data-testid="sessions-list">
          <h2 id="sessions-list-heading" className="sr-only">
            {t('listHeading')}
          </h2>
          <TimelineList
            items={sessions || []}
            itemKey={(session) => session.id}
            renderItem={(session) => (
              <SessionCardTimeline session={session} onSignOut={signOut.ask} />
            )}
            highlightIndex={currentSessionIndex}
            stagger={shouldAnimate}
          />
        </section>
      </Activity>

      <SessionSignOutDialog
        open={signOut.isOpen}
        target={signOut.target}
        sessions={sessions}
        onClose={signOut.close}
        landing={titleRef}
      />
    </div>
  );
}
