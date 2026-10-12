import { isNativeEmail } from './native-email';

const SUFFIX = '@example.test';
const EMAIL_AT_LIMIT = `${'a'.repeat(255 - SUFFIX.length)}${SUFFIX}`;
const EMAIL_OVER_LIMIT = `${'a'.repeat(256 - SUFFIX.length)}${SUFFIX}`;

describe('native email wire decision', () => {
  it('accepts a valid email at exactly 255 UTF-16 units', () => {
    expect(isNativeEmail(EMAIL_AT_LIMIT)).toBe(true);
  });

  it.each([
    ['overlong', EMAIL_OVER_LIMIT],
    ['malformed', 'missing-domain'],
    ['blank', ''],
    ['null', null],
    ['undefined', undefined],
    ['nonstring', 42],
  ])('rejects %s input', (_, value) => {
    expect(isNativeEmail(value)).toBe(false);
  });
});
