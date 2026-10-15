import { useFormatter, useTranslations } from 'next-intl';
import { Heading } from '@/components/design-system';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { WRAP_ANYWHERE_CLASSES } from '@/constants/textWrap';
import type { ActivityEvent } from '../types/activity.types';

interface Props {
  event: ActivityEvent;
}

export function ActivityRow({ event }: Props) {
  const t = useTranslations('activity');
  const format = useFormatter();
  const metadata = [
    ['actor', event.actorId],
    ['target', event.targetUserId],
    ['application', event.clientId],
    ['event', event.id],
  ] as const;

  return (
    <Card role="article" className="p-4" data-testid="activity-event">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Heading level={2} variant="subsectionTitle" className={WRAP_ANYWHERE_CLASSES}>
          {t.has(`actions.${event.action}`) ? (
            t(`actions.${event.action}`)
          ) : (
            <bdi>{event.action}</bdi>
          )}
        </Heading>
        <Badge variant="outline">
          {t.has(`outcomes.${event.outcome}`) ? (
            t(`outcomes.${event.outcome}`)
          ) : (
            <bdi>{event.outcome}</bdi>
          )}
        </Badge>
      </div>
      <time dateTime={event.occurredAt} className="mt-1 block text-sm text-muted-foreground">
        {format.dateTime(new Date(event.occurredAt), { dateStyle: 'medium', timeStyle: 'medium' })}
      </time>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        {metadata.map(([field, value]) => (
          <div key={field} className={WRAP_ANYWHERE_CLASSES}>
            <dt className="text-muted-foreground">{t(`fields.${field}`)}</dt>
            <dd>
              <bdi>{value ?? t('unavailable')}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      {Object.keys(event.details).length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer">{t('details')}</summary>
          <dl className="mt-2 grid gap-3 sm:grid-cols-2">
            {Object.entries(event.details).map(([key, value]) => (
              <div key={key} className={WRAP_ANYWHERE_CLASSES}>
                <dt className="text-muted-foreground">
                  {t.has(`detailFields.${key}`) ? t(`detailFields.${key}`) : <bdi>{key}</bdi>}
                </dt>
                <dd>
                  {typeof value === 'boolean' ? (
                    t(value ? 'values.yes' : 'values.no')
                  ) : Array.isArray(value) ? (
                    <ul>
                      {value.map((item) => (
                        <li key={item}>
                          {key === 'changedFields' && t.has(`detailFields.${item}`) ? (
                            t(`detailFields.${item}`)
                          ) : (
                            <bdi>{item}</bdi>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <bdi>{String(value)}</bdi>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </Card>
  );
}
