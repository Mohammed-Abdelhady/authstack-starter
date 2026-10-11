import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../src/i18n';
import { startingNotice } from '../src/logic/host';

describe('what a shell shows while it prepares', () => {
  it.each([
    ['en', 'ltr'],
    ['ar', 'rtl'], // feature:locale-ar
  ] as const)('reads the catalogue of %s in the direction %s', (locale, direction) => {
    expect(startingNotice(locale)).toEqual({
      text: MESSAGES[locale]['common.starting'],
      direction,
    });
  });
});
