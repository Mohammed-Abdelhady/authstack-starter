import { describe, expect, it } from 'vitest';
import { validNativeEmail, validNativePassword } from '../src/logic/native-form-validation';

describe('native field validation', () => {
  it.each([
    ['', false],
    ['   ', false],
    ['a', false],
    ['a@b', false],
    ['a@b.c', true],
    ['a'.repeat(250) + '@a.co', true],
    ['a'.repeat(251) + '@a.co', false],
  ] as const)('validates the bounded email %s', (value, valid) => {
    expect(validNativeEmail(value)).toBe(valid);
  });
  it.each([
    ['', false],
    ['   ', false],
    ['existing-secret', true],
    ['a'.repeat(72), true],
    ['a'.repeat(73), false],
    ['Aa1' + 'é'.repeat(34) + 'x', true],
    ['Aa1' + 'é'.repeat(35), false],
  ] as const)('keeps exact login credentials within the UTF-8 boundary', (value, valid) => {
    expect(validNativePassword(value)).toBe(valid);
  });
  it.each([
    ['Aa1xxxx', false],
    ['Aa1xxxxx', true],
    ['aa1xxxxx', false],
    ['AA1XXXXX', false],
    ['Aaxxxxxx', false],
    ['Aa1' + 'x'.repeat(69), true],
    ['Aa1' + 'x'.repeat(70), false],
  ] as const)('applies the existing creation policy', (value, valid) => {
    expect(validNativePassword(value, true)).toBe(valid);
  });
});
