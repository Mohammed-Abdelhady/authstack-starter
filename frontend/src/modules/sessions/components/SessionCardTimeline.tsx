'use client';

import { Heading } from '@/components/design-system';
import { memo, useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { LogOut, MapPin, Clock, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DeviceIcon } from './DeviceIcon';
import { CurrentSessionBadge } from './CurrentSessionBadge';
import { SessionKindBadge } from './SessionKindBadge';
import { SESSION_KIND } from '../constants';
import { describeNativeDevice, sessionKindOf, sessionDeviceText } from '../utils/sessionDevice';
import { parseUserAgent } from '@/lib/parseUserAgent';
import type { Session } from '@app/sdk';
import type { SignOutTarget } from './SessionSignOutDialog';
import { WRAP_ANYWHERE_CLASSES } from '@/constants/textWrap';
import { cn } from '@/lib/utils';
import { formatTimeAgo } from '@/lib/formatters';

interface SessionCardTimelineProps {
  readonly session: Session;
  /** Asks to sign this session out. The page confirms it, for the session as it is now. */
  readonly onSignOut?: (target: SignOutTarget) => void;
}

/**
 * SessionCardTimeline - Redesigned session card for timeline view
 *
 * Features:
 * - Timeline-style vertical layout
 * - Current session emphasized with pulsing border
 * - Device icon with metadata rows
 * - Minimal aesthetic with refined spacing
 * - Hover state for interactive sessions
 * - Optimized with React.memo for performance
 *
 * @example
 * ```tsx
 * <SessionCardTimeline session={session} />
 * ```
 */
export const SessionCardTimeline = memo(
  function SessionCardTimeline({ session, onSignOut }: SessionCardTimelineProps) {
    const t = useTranslations('sessions');
    const locale = useLocale();

    const { device, browser, os } = parseUserAgent(session.userAgent);

    const titleId = useId();
    const kindId = useId();
    const kind = sessionKindOf(session.credentialPurpose);
    // The app's user agent is not a browser, so a native row is named by its system alone.
    const nativeDevice =
      kind === SESSION_KIND.NATIVE_APP ? describeNativeDevice(session.userAgent) : null;
    const displayedName = sessionDeviceText(session, t);

    const lastActivity = formatTimeAgo(session.lastUsedAt || session.createdAt, locale);
    const createdAt = formatTimeAgo(session.createdAt, locale);

    return (
      <article
        aria-labelledby={kind ? `${titleId} ${kindId}` : titleId}
        data-testid={`session-card-timeline-${session.id}`}
        className={cn(
          'relative p-4 rounded-lg transition-all duration-200',
          'bg-card',
          session.isCurrent
            ? 'border-2 border-status-success/30 shadow-md'
            : 'border border-border hover:border-input hover:shadow-sm',
        )}
      >
        {/* Device Header */}
        <header className="flex items-start justify-between mb-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <DeviceIcon
              deviceType={
                nativeDevice?.deviceType ?? (device as 'Desktop' | 'Mobile' | 'Tablet' | 'Unknown')
              }
              size="lg"
            />
            <div className={cn('flex-1', WRAP_ANYWHERE_CLASSES)}>
              <Heading
                level={3}
                variant="subsectionTitle"
                className="flex flex-wrap items-center gap-2"
              >
                <span id={titleId} data-testid="session-device-label">
                  {displayedName}
                </span>
                {session.isCurrent && <CurrentSessionBadge pulse />}
              </Heading>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                {kind && <SessionKindBadge id={kindId} kind={kind} />}
                {!nativeDevice && (
                  <p
                    dir="ltr"
                    className="text-sm text-card-foreground"
                    data-testid="session-browser-os"
                  >
                    {browser} · {os}
                  </p>
                )}
              </div>
            </div>
          </div>

          {!session.isCurrent && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSignOut?.({ id: session.id, deviceName: displayedName })}
              aria-label={t('logoutThisDevice')}
              className="text-destructive hover:text-destructive hover:bg-destructive/10 ms-2"
              data-testid="logout-session-button"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </header>

        {/* Session Metadata */}
        <div className="space-y-1 text-sm text-card-foreground">
          <div className="flex items-center gap-2" data-testid="session-ip-row">
            <MapPin className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            <span dir="ltr" data-testid="session-ip">
              {session.ip}
            </span>
          </div>
          <div className="flex items-center gap-2" data-testid="session-last-activity-row">
            <Clock className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            <span data-testid="session-last-activity">
              {t('lastActive', { time: lastActivity })}
            </span>
          </div>
          <div className="flex items-center gap-2" data-testid="session-created-at-row">
            <Calendar className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            <span data-testid="session-created-at">{t('loggedInAt', { time: createdAt })}</span>
          </div>
        </div>
      </article>
    );
  },
  (prevProps, nextProps) => {
    // Only re-render if session data actually changes
    return (
      prevProps.session.id === nextProps.session.id &&
      prevProps.session.lastUsedAt === nextProps.session.lastUsedAt &&
      prevProps.session.isCurrent === nextProps.session.isCurrent &&
      prevProps.session.deviceName === nextProps.session.deviceName &&
      prevProps.session.deviceParts?.kind === nextProps.session.deviceParts?.kind &&
      prevProps.session.deviceParts?.browserName === nextProps.session.deviceParts?.browserName &&
      prevProps.session.deviceParts?.browserMajorVersion ===
        nextProps.session.deviceParts?.browserMajorVersion &&
      prevProps.session.deviceParts?.platformName === nextProps.session.deviceParts?.platformName &&
      prevProps.session.deviceParts?.platformVersion ===
        nextProps.session.deviceParts?.platformVersion
    );
  },
);
