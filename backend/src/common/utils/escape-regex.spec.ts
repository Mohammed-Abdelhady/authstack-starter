import { escapeRegex } from './escape-regex';

describe('escapeRegex', () => {
  it('escapes dots', () => {
    expect(escapeRegex('user.name@example.com')).toBe(
      'user\\.name@example\\.com',
    );
  });

  it('escapes all metacharacters combined', () => {
    const specialChars = '.*+?^${}()|[]\\';
    const escaped = escapeRegex(specialChars);
    expect(escaped).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
    const regex = new RegExp(escaped);
    expect(regex.test(specialChars)).toBe(true);
  });
});
