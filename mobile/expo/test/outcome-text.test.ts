import { describe, expect, it } from 'vitest';
import { describeError, render } from '../src/logic/outcome-text';
const LOCALES = [
  'en',
  'ar', // feature:locale-ar
] as const;

describe('an error a request rejects with', () => {
  it.each(LOCALES)('never prints the message an error carries, in %s', (locale) => {
    const text = render(locale, describeError(new RangeError('too large')));

    expect(text).not.toContain('too large');
    expect(text).toContain('RangeError');
  });
});
