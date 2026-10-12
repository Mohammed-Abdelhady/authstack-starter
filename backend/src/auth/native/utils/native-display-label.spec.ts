import { nativeDisplayLabel } from './native-display-label';

const CLIENT_ID = 'native-label-client';

describe('native application and provider display labels', () => {
  it('preserves a label within the UTF16 budget', () => {
    expect(nativeDisplayLabel('Ada', CLIENT_ID)).toBe('Ada');
  });

  it('trims surrounding whitespace and normalizes to NFC', () => {
    expect(nativeDisplayLabel(' \tE\u0301mile\n ', CLIENT_ID)).toBe('Émile');
  });

  it.each([
    { length: 160, expected: 'n'.repeat(160) },
    { length: 161, expected: 'n'.repeat(160) },
  ])(
    'bounds $length letters to the UTF16 wire budget',
    ({ length, expected }) => {
      expect(nativeDisplayLabel('n'.repeat(length), CLIENT_ID)).toBe(expected);
    },
  );

  it.each([
    { length: 80, expected: '\u{10400}'.repeat(80) },
    { length: 81, expected: '\u{10400}'.repeat(80) },
  ])(
    'bounds $length supplementary letters without splitting them',
    ({ length, expected }) => {
      expect(nativeDisplayLabel('\u{10400}'.repeat(length), CLIENT_ID)).toBe(
        expected,
      );
    },
  );

  it('omits an entire supplementary letter crossing the budget', () => {
    expect(nativeDisplayLabel(`${'n'.repeat(159)}\u{10400}z`, CLIENT_ID)).toBe(
      'n'.repeat(159),
    );
  });

  it('normalizes before applying the UTF16 budget', () => {
    expect(nativeDisplayLabel(`${'n'.repeat(159)}E\u0301z`, CLIENT_ID)).toBe(
      `${'n'.repeat(159)}É`,
    );
  });

  it('removes trailing whitespace exposed by truncation', () => {
    expect(nativeDisplayLabel(`${'n'.repeat(159)} z`, CLIENT_ID)).toBe(
      'n'.repeat(159),
    );
  });

  it.each([
    ['empty', ''],
    ['blank', ' \t\n '],
    ['missing', undefined],
    ['null', null],
    ['number', 42],
    ['object', {}],
  ])('uses the real identifier when the label is %s', (_label, value) => {
    expect(nativeDisplayLabel(value, CLIENT_ID)).toBe(CLIENT_ID);
  });

  it('normalizes and trims the identifier fallback', () => {
    expect(nativeDisplayLabel('', ' E\u0301mile ')).toBe('Émile');
  });

  it('bounds the identifier fallback without splitting supplementary letters', () => {
    expect(nativeDisplayLabel(undefined, `${'n'.repeat(159)}\u{10400}`)).toBe(
      'n'.repeat(159),
    );
  });
});
