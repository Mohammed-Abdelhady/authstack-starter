import {
  chosenLocale,
  negotiateLocale,
  requestLocale,
  storedLocale,
} from './locales';

/** About 4 KB of separators, empty ranges and broken qualities. */
const JUNK_HEADER = ';;q=abc,,=,*;q=-1,'.repeat(240);

describe('requestLocale', () => {
  it.each([
    { label: 'the body language', body: 'en', header: 'fr', expected: 'en' },
    { label: 'a regional body tag', body: 'en-GB', header: '', expected: 'en' },
    {
      label: 'the header when the body has none',
      body: undefined,
      header: 'fr-CA, en;q=0.5',
      expected: 'en',
    },
    {
      label: 'the header when the body names an unsupported language',
      body: 'fr',
      header: 'en',
      expected: 'en',
    },
    {
      label: 'the header when the body is not text',
      body: 7,
      header: 'en',
      expected: 'en',
    },
    {
      label: 'the default when the body is blank and the header is missing',
      body: '',
      header: undefined,
      expected: 'en',
    },
    {
      label: 'the default for an unsupported body and header',
      body: 'de',
      header: 'fr-FR',
      expected: 'en',
    },
    // feature:locale-ar:start
    {
      label: 'the body language over the header',
      body: 'ar',
      header: 'en',
      expected: 'ar',
    },
    // feature:locale-ar:end
  ])('takes $label', ({ body, header, expected }) => {
    expect(requestLocale(body, header)).toBe(expected);
  });
});

describe('negotiateLocale', () => {
  it.each([
    { label: 'a lone wildcard', header: '*', expected: 'en' },
    {
      label: 'an unsupported language before a low wildcard',
      header: 'fr,*;q=0.1',
      expected: 'en',
    },
    {
      label: 'the default excluded and nothing else',
      header: 'en;q=0',
      expected: 'en',
    },
    { label: 'an empty header', header: '', expected: 'en' },
    { label: 'a header of spaces', header: '   ', expected: 'en' },
    { label: 'no header', header: undefined, expected: 'en' },
    { label: 'about 4 KB of junk', header: JUNK_HEADER, expected: 'en' },
    // feature:locale-ar:start
    {
      label: 'the default when the only language named is excluded',
      header: 'ar;q=0',
      expected: 'en',
    },
    {
      label: 'the wildcard past an excluded default',
      header: 'en;q=0,*;q=1',
      expected: 'ar',
    },
    {
      label: 'the wildcard past an excluded language',
      header: 'ar;q=0,*',
      expected: 'en',
    },
    {
      label: 'a wildcard above a named language',
      header: 'ar-EG;q=0.2, *;q=0.9',
      expected: 'en',
    },
    {
      label: 'a named language above the wildcard',
      header: '*;q=0.5, ar',
      expected: 'ar',
    },
    {
      label: 'header order on equal quality',
      header: 'ar;q=0.5, en;q=0.5',
      expected: 'ar',
    },
    {
      label: 'the position of the best range, not of the first',
      header: 'ar;q=0.1,en;q=1,ar-SA;q=1',
      expected: 'en',
    },
    {
      label: 'a language whose best range comes first',
      header: 'ar-SA;q=1,en;q=1,ar;q=0.1',
      expected: 'ar',
    },
    {
      label: 'past a weight with trailing junk',
      header: 'ar;q=1junk,en;q=0.5',
      expected: 'en',
    },
    { label: 'past a weight above 1', header: 'ar;q=1.5', expected: 'en' },
    { label: 'past a negative weight', header: 'ar;q=-1', expected: 'en' },
    {
      label: 'a weight with an upper-case name and spaces',
      header: 'ar; Q = 0.8',
      expected: 'ar',
    },
    {
      label: 'an upper-case weight that excludes a language',
      header: 'ar; Q=0, en;q=0.5',
      expected: 'en',
    },
    {
      label: 'the first of two ranges at a language best quality',
      header: 'ar;q=1,en;q=1,ar-SA;q=1',
      expected: 'ar',
    },
    {
      label: 'past a weight with four decimals',
      header: 'ar;q=0.0001',
      expected: 'en',
    },
    // feature:locale-ar:end
  ])('answers $label', ({ header, expected }) => {
    expect(negotiateLocale(header)).toBe(expected);
  });
});

describe('chosenLocale', () => {
  it.each([
    { label: 'a supported body language', body: 'en-GB', expected: 'en' },
    { label: 'an unsupported body language', body: 'fr', expected: 'en' },
    { label: 'no body language', body: undefined, expected: 'en' },
    { label: 'a body language that is not text', body: 7, expected: 'en' },
  ])('reads $label', ({ body, expected }) => {
    expect(chosenLocale(body)).toBe(expected);
  });
});

describe('storedLocale', () => {
  it.each([
    { label: 'a supported language', value: 'en', expected: 'en' },
    { label: 'a record with no language', value: undefined, expected: 'en' },
    { label: 'a null column', value: null, expected: 'en' },
    { label: 'a language this build lacks', value: 'fr', expected: 'en' },
    { label: 'a blank value', value: '', expected: 'en' },
  ])('reads $label', ({ value, expected }) => {
    expect(storedLocale(value)).toBe(expected);
  });
});
