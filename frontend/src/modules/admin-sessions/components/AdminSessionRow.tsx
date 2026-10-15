import { useCallback } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Heading } from '@/components/design-system';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { WRAP_ANYWHERE_CLASSES } from '@/constants/textWrap';
import { sessionDeviceText, sessionKindOf } from '@/modules/sessions/utils/sessionDevice';
import { SessionKindBadge } from '@/modules/sessions/components/SessionKindBadge';
import type { AdminSession } from '../types/admin-session.types';

interface Props {
  session: AdminSession;
  canEnd: boolean;
  onEnd: (session: AdminSession) => void;
}

export function AdminSessionRow({ session, canEnd, onEnd }: Props) {
  const t = useTranslations('adminSessions');
  const tSessions = useTranslations('sessions');
  const format = useFormatter();
  const name = sessionDeviceText(session, tSessions);
  const kind = sessionKindOf(session.credentialPurpose);
  const end = useCallback(() => onEnd(session), [onEnd, session]);

  return (
    <Card role="article" className="p-4" data-testid="admin-session-row">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className={WRAP_ANYWHERE_CLASSES}>
          <Heading level={3} variant="subsectionTitle">
            <bdi>{name}</bdi>
          </Heading>
          <div className="mt-2 flex flex-wrap gap-2">
            {kind && <SessionKindBadge kind={kind} />}
            <Badge variant="outline">
              <bdi>{session.clientId}</bdi>
            </Badge>
          </div>
        </div>
        {canEnd && (
          <Button variant="outline" size="sm" onClick={end} data-testid="admin-session-end">
            {t('endOne')}
          </Button>
        )}
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className={WRAP_ANYWHERE_CLASSES}>
          <dt className="text-muted-foreground">{t('application')}</dt>
          <dd>
            <bdi>{session.clientId}</bdi>
          </dd>
        </div>
        <div className={WRAP_ANYWHERE_CLASSES}>
          <dt className="text-muted-foreground">{t('ip')}</dt>
          <dd>
            <bdi>{session.ip}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('lastActive')}</dt>
          <dd>
            {format.dateTime(new Date(session.lastUsedAt ?? session.createdAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
