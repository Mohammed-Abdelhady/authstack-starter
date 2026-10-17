import { describe, expect, it } from 'vitest';
import { filterDigits } from '../digitFilter';

describe('filterDigits', () => {
  it('keeps only digits when input contains letters and special characters', () => {
    expect(filterDigits('abc123xyz')).toBe('123');
    expect(filterDigits('1-2-3-4-5-6')).toBe('123456');
    expect(filterDigits('code: 987654!')).toBe('987654');
  });

  it('returns empty string when input has no digits', () => {
    expect(filterDigits('abcdef')).toBe('');
    expect(filterDigits('!@#$%^&*()')).toBe('');
  });

  it('truncates to default maximum length of 6', () => {
    expect(filterDigits('1234567890')).toBe('123456');
  });

  it('honors custom maximum length parameter', () => {
    expect(filterDigits('1234567890', 4)).toBe('1234');
    expect(filterDigits('1234567890', 8)).toBe('12345678');
  });
});
