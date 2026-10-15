import { ACTIVITY_FILTER_FIELDS, ACTIVITY_FILTER_PATTERN } from '../constants/activity';
import type { ActivityFilters } from '../types/activity.types';

export function parseActivityFilters(
  form: FormData,
): { filters: ActivityFilters } | { error: 'invalidRange' | 'invalidInput' } {
  const filters: ActivityFilters = {};
  for (const field of ACTIVITY_FILTER_FIELDS) {
    const value = form.get(field)?.toString();
    if (!value) continue;
    if (field === 'from' || field === 'to') {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return { error: 'invalidRange' };
      filters[field] = date.toISOString();
    } else {
      if (!ACTIVITY_FILTER_PATTERN.test(value)) return { error: 'invalidInput' };
      filters[field] = value;
    }
  }
  if (filters.from && filters.to && filters.from >= filters.to) {
    return { error: 'invalidRange' };
  }
  return { filters };
}
