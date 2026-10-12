'use client';

/**
 * The browser step of native sign-in. It is a client component because it
 * reads the browser session, runs the approve/deny requests and moves focus
 * and the browser between states. The state machine lives in
 * `useNativeAuthorize`; the views are the small components beside it.
 */

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { LoadingRegion } from '@/components/layout/LoadingRegion';
import { NativeAuthorizeDisabledView } from './NativeAuthorizeDisabledView';
import { NativeAuthorizeErrorView } from './NativeAuthorizeErrorView';
import { NativeAuthorizeExpiredView } from './NativeAuthorizeExpiredView';
import { NativeAuthorizeReadyView } from './NativeAuthorizeReadyView';
import { NativeAuthorizeReturningView } from './NativeAuthorizeReturningView';
import { useNativeAuthorize } from './useNativeAuthorize';

interface NativeAuthorizePanelProps {
  /** Transaction id from the authorize route query string. */
  transaction: string;
}

function announcementFor(
  action: 'approve' | 'deny' | 'notYou' | null,
  t: (key: string) => string,
): string {
  if (action === 'approve') {
    return t('approving');
  }
  if (action === 'deny') {
    return t('denying');
  }
  if (action === 'notYou') {
    return t('signingOut');
  }
  return '';
}

/**
 * One confirmation card for a mobile app's sign-in request.
 *
 * A single live region stays mounted across every state, and focus moves to
 * the heading of each view, so a keyboard or screen-reader user is told what
 * happened after every change.
 */
export function NativeAuthorizePanel({ transaction }: NativeAuthorizePanelProps) {
  const t = useTranslations('auth.nativeAuthorize');
  const { view, approve, deny, notYou, retry, reopen } = useNativeAuthorize(transaction);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [view.kind]);

  // The pressed button is disabled while its request runs, which drops focus
  // to the page. The card stays up for the new account, so put focus back.
  useEffect(() => {
    if (view.accountChanged) {
      headingRef.current?.focus();
    }
  }, [view.accountChanged]);

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only" data-testid="native-authorize-status">
        {announcementFor(view.action, t)}
      </p>

      {view.kind === 'loading' && (
        <LoadingRegion label={t('loading')} testId="native-authorize-loading" />
      )}
      {view.kind === 'ready' && (
        <NativeAuthorizeReadyView
          applicationName={view.applicationName}
          accountName={view.accountName}
          accountEmail={view.accountEmail}
          accountChanged={view.accountChanged}
          action={view.action}
          headingRef={headingRef}
          onApprove={approve}
          onDeny={deny}
          onNotYou={notYou}
        />
      )}
      {view.kind === 'returning' && (
        <NativeAuthorizeReturningView
          canReopen={view.canReopen}
          headingRef={headingRef}
          onReopen={reopen}
        />
      )}
      {view.kind === 'expired' && <NativeAuthorizeExpiredView headingRef={headingRef} />}
      {view.kind === 'disabled' && <NativeAuthorizeDisabledView headingRef={headingRef} />}
      {view.kind === 'error' && (
        <NativeAuthorizeErrorView
          message={view.failure?.message ?? ''}
          headingRef={headingRef}
          onRetry={retry}
        />
      )}
    </>
  );
}
