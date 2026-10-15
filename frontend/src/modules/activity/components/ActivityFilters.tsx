'use client';

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormRootError } from '@/components/forms';
import { ACTIVITY_FILTER_FIELDS, ACTIVITY_MAX_FILTER_LENGTH } from '../constants/activity';
import { parseActivityFilters } from '../utils/parseActivityFilters';
import type { ActivityFilters as Filters } from '../types/activity.types';

interface Props {
  onApply: (filters: Filters) => void;
  busy: boolean;
}

export function ActivityFilters({ onApply, busy }: Props) {
  const t = useTranslations('activity');
  const id = useId();
  const [invalid, setInvalid] = useState<'invalidRange' | 'invalidInput' | null>(null);

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = parseActivityFilters(new FormData(event.currentTarget));
    if ('error' in result) {
      setInvalid(result.error);
      return;
    }
    setInvalid(null);
    onApply(result.filters);
  };

  const clear = () => {
    setInvalid(null);
    onApply({});
  };

  return (
    <form onSubmit={apply} onReset={clear} className="space-y-4" data-testid="activity-filters">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ACTIVITY_FILTER_FIELDS.map((field) => (
          <div key={field} className="min-w-0 space-y-2">
            <Label htmlFor={`${id}-${field}`}>{t(`filters.${field}`)}</Label>
            <Input
              id={`${id}-${field}`}
              name={field}
              type={field === 'from' || field === 'to' ? 'datetime-local' : 'text'}
              maxLength={ACTIVITY_MAX_FILTER_LENGTH}
              dir="ltr"
              data-testid={`activity-filter-${field}`}
            />
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{t('dateWindow')}</p>
      <FormRootError error={invalid ? t(invalid) : null} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" busy={busy} data-testid="activity-apply-filters">
          {t('apply')}
        </Button>
        <Button type="reset" variant="outline" busy={busy} data-testid="activity-clear-filters">
          {t('clear')}
        </Button>
      </div>
    </form>
  );
}
