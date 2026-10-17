import { escapeRegex } from './escape-regex';

describe('escapeRegex', () => {
  it('escapes dots', () => {
    expect(escapeRegex('user.name@example.com')).toBe(
      'user\\.name@example\\.com',
    );
  });

  it('escapes regex wildcards and quantifiers', () => {
    expect(escapeRegex('a*b+c?')).toBe('a\\*b\\+c\\?');
  });

  it('escapes anchors', () => {
    expect(escapeRegex('^start$end')).toBe('\\^start\\$end');
  });

  it('escapes brackets and braces', () => {
    expect(escapeRegex('[admin]{1,2}(group)')).toBe(
      '\\[admin\\]\\{1,2\\}\\(group\\)',
    );
  });

  it('escapes pipe alternation and backslashes', () => {
    expect(escapeRegex('a|b\\c')).toBe('a\\|b\\\\c');
  });

  it('escapes all metacharacters combined', () => {
    const specialChars = '.*+?^${}()|[]\\';
    const escaped = escapeRegex(specialChars);
    expect(escaped).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
    const regex = new RegExp(escaped);
    expect(regex.test(specialChars)).toBe(true);
  });
});
