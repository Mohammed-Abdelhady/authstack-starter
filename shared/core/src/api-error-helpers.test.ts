import { describe, expect, it } from 'vitest';
import { extractFieldErrors, getStatusErrorCode } from './api-error-helpers';

describe('getStatusErrorCode', () => {
  it.each([
    [400, 'INVALID_INPUT'],
    [401, 'SESSION_INVALID'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [429, 'RATE_LIMIT_EXCEEDED'],
    [500, 'INTERNAL_ERROR'],
    [502, 'INTERNAL_ERROR'],
    [503, 'INTERNAL_ERROR'],
    [504, 'INTERNAL_ERROR'],
  ])('maps %i to %s', (status, code) => {
    expect(getStatusErrorCode(status)).toBe(code);
  });

  it.each([undefined, 0, 200, 302, 418, 499, 501])('answers UNKNOWN_ERROR for %s', (status) => {
    expect(getStatusErrorCode(status)).toBe('UNKNOWN_ERROR');
  });
});

describe('extractFieldErrors', () => {
  it('reads the fields the server sends', () => {
    const fields = extractFieldErrors({
      fields: { Name: ['Name must be at least 2 characters'], email: ['email must be an email'] },
    });

    expect(fields).toEqual({
      Name: ['Name must be at least 2 characters'],
      email: ['email must be an email'],
    });
  });

  it('drops entries that are not a list of strings', () => {
    const fields = extractFieldErrors({
      fields: { name: ['too short'], email: 'not a list', age: [1, 2], nested: { a: ['x'] } },
    });

    expect(fields).toEqual({ name: ['too short'] });
  });

  it.each([
    ['no details', undefined],
    ['null details', null],
    ['list details', []],
    ['numeric details', 17],
    ['details without fields', { retryAfter: 60 }],
    ['undefined fields', { fields: undefined }],
    ['null fields', { fields: null }],
    ['fields that are a list', { fields: [['name', ['too short']]] }],
    ['fields with nothing usable', { fields: { email: 'not a list' } }],
    ['empty fields', { fields: {} }],
    ['the shape the server never sent', { errors: [{ field: 'email', messages: ['bad'] }] }],
  ])('answers undefined for %s', (_label, details) => {
    expect(extractFieldErrors(details)).toBeUndefined();
  });

  it('keeps a field named __proto__ as an ordinary key', () => {
    const details: unknown = JSON.parse('{"fields":{"__proto__":["polluted"],"name":["short"]}}');

    const fields = extractFieldErrors(details);

    expect(Object.keys(fields ?? {}).sort()).toEqual(['__proto__', 'name']);
    expect(Object.getPrototypeOf(fields)).toBeNull();
    expect(Object.getOwnPropertyDescriptor(fields, '__proto__')?.value).toEqual(['polluted']);
  });
});
