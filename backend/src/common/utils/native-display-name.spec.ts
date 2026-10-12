import { nativeDisplayName } from './native-display-name';

const EMAIL = 'identity@example.test';

describe('native public display names', () => {
  it('preserves a name inside the public character budget', () => {
    expect(nativeDisplayName('Ada', EMAIL)).toBe('Ada');
  });

  it('trims surrounding whitespace and normalizes to NFC', () => {
    expect(nativeDisplayName(' \tE\u0301mile\n ', EMAIL)).toBe('Émile');
  });

  it.each([
    { length: 100, expected: 'n'.repeat(100) },
    { length: 101, expected: 'n'.repeat(100) },
  ])(
    'projects a $length-letter name into the wire budget',
    ({ length, expected }) => {
      expect(nativeDisplayName('n'.repeat(length), EMAIL)).toBe(expected);
    },
  );

  it.each([
    { length: 100, expected: '\u{10400}'.repeat(100) },
    { length: 101, expected: '\u{10400}'.repeat(100) },
  ])(
    'preserves complete code points at $length supplementary letters',
    ({ length, expected }) => {
      expect(nativeDisplayName('\u{10400}'.repeat(length), EMAIL)).toBe(
        expected,
      );
    },
  );

  it('normalizes before truncating at the code-point boundary', () => {
    expect(nativeDisplayName(`${'\u{10400}'.repeat(99)}E\u0301z`, EMAIL)).toBe(
      `${'\u{10400}'.repeat(99)}É`,
    );
  });

  it.each([
    ['empty', ''],
    ['whitespace', ' \t\n '],
    ['missing', undefined],
    ['null', null],
    ['number', 42],
    ['object', {}],
  ])('uses the address when the name is %s', (_label, name) => {
    expect(nativeDisplayName(name, EMAIL)).toBe(EMAIL);
  });

  it('trims and normalizes the address fallback', () => {
    expect(nativeDisplayName('', ' E\u0301mile@example.test ')).toBe(
      'Émile@example.test',
    );
  });

  it('bounds an address fallback exceeding the name wire budget', () => {
    expect(
      nativeDisplayName(undefined, `${'a'.repeat(101)}@example.test`),
    ).toBe('a'.repeat(100));
  });
});
