import { describe, expect, it } from 'vitest';
import { parseActivityFilters } from '../parseActivityFilters';
import { activityPageCount } from '../activityPageCount';

describe('activity request boundaries', () => {
  it.each([
    [0, 10, 1],
    [1000, 10, 1000],
    [1001, 10, 1001],
    [1002, 10, 1001],
    [101, 100, 101],
    [102, 100, 101],
  ])('bounds %i pages at limit %i to %i', (totalPages, limit, expected) => {
    expect(activityPageCount(totalPages, limit)).toBe(expected);
  });

  it.each(['a'.repeat(201), 'staff member', "staff'", '_staff', ' staff'])(
    'refuses an identifier outside the server grammar',
    (value) => {
      const form = new FormData();
      form.set('actor', value);
      expect(parseActivityFilters(form)).toEqual({ error: 'invalidInput' });
    },
  );

  it('accepts the server length boundary and punctuation grammar', () => {
    const form = new FormData();
    form.set('actor', 'a'.repeat(200));
    form.set('action', 'account_updated');
    form.set('target', 'target-1.test:@/name');
    expect(parseActivityFilters(form)).toEqual({
      filters: {
        actor: 'a'.repeat(200),
        action: 'account_updated',
        target: 'target-1.test:@/name',
      },
    });
  });

  it.each([
    ['not-a-date', '2026-10-01T12:00'],
    ['2026-10-01T12:00', '2026-10-01T12:00'],
    ['2026-10-02T12:00', '2026-10-01T12:00'],
  ])('refuses invalid or non-increasing date bounds', (from, to) => {
    const form = new FormData();
    form.set('from', from);
    form.set('to', to);
    expect(parseActivityFilters(form)).toEqual({ error: 'invalidRange' });
  });
});
