import { describe, expect, it } from 'vitest';
import { getRedirectPath } from '../authHelpers';
import { signedInPath, twoFactorPath } from '../signInRouting';

describe('getRedirectPath', () => {
  it('rejects external absolute URLs', () => {
    expect(getRedirectPath('https://evil.com')).toBe('/dashboard');
  });

  it('preserves valid relative paths with query parameters', () => {
    expect(getRedirectPath('/dashboard?x=1')).toBe('/dashboard?x=1');
  });

  it('allows plain valid relative paths', () => {
    expect(getRedirectPath('/settings')).toBe('/settings');
    expect(getRedirectPath('/admin/users')).toBe('/admin/users');
  });

  it('normalises a supported-locale prefix off an ordinary path', () => {
    expect(getRedirectPath('/en/dashboard')).toBe('/dashboard');
    expect(getRedirectPath('/ar/settings?tab=1')).toBe('/settings?tab=1'); // feature:locale-ar
    expect(getRedirectPath('/english')).toBe('/english');
  });

  it('returns custom default path when candidate is invalid', () => {
    expect(getRedirectPath('https://evil.com', '/custom-dashboard')).toBe('/custom-dashboard');
    expect(getRedirectPath('/auth/login', '/admin/dashboard')).toBe('/admin/dashboard');
  });

  it('handles empty, null, or undefined input', () => {
    expect(getRedirectPath('')).toBe('/dashboard');
    expect(getRedirectPath(null)).toBe('/dashboard');
    expect(getRedirectPath(undefined)).toBe('/dashboard');
  });
});

describe('getRedirectPath native authorize continuation', () => {
  const ROUTE = '/auth/native/authorize?transaction=abc123';

  it.each([
    [ROUTE, ROUTE],
    [`/en${ROUTE}`, ROUTE],
    [`/ar${ROUTE}`, ROUTE], // feature:locale-ar
    [
      '/auth/native/authorize?transaction=a%2Fb%2Bc',
      '/auth/native/authorize?transaction=a%2Fb%2Bc',
    ],
  ])('accepts %s and normalises it to %s', (candidate, expected) => {
    expect(getRedirectPath(candidate)).toBe(expected);
  });

  it('keeps a custom default when the candidate is rejected', () => {
    expect(getRedirectPath('/auth/native/authorize', '/admin/dashboard')).toBe('/admin/dashboard');
    expect(getRedirectPath(`/en${ROUTE}`, '/admin/dashboard')).toBe(ROUTE);
  });

  it.each([
    ['another query key', '/auth/native/authorize?redirect=https%3A%2F%2Fevil.com'],
    ['an extra key', `${ROUTE}&redirect=/dashboard`],
    ['a leading extra key', '/auth/native/authorize?redirect=/dashboard&transaction=abc123'],
    ['an empty transaction', '/auth/native/authorize?transaction='],
    ['no transaction', '/auth/native/authorize'],
    ['a duplicated transaction', '/auth/native/authorize?transaction=one&transaction=two'],
    ['an extra path segment', '/auth/native/authorize/extra?transaction=abc123'],
    ['another native route', '/auth/native/other?transaction=abc123'],
    ['a fragment', `${ROUTE}#section`],
    ['a second English locale prefix', '/en/en/auth/native/authorize?transaction=abc123'],
    ['a second locale prefix', '/en/ar/auth/native/authorize?transaction=abc123'], // feature:locale-ar
  ])('rejects the native route with %s', (_label, candidate) => {
    expect(getRedirectPath(candidate)).toBe('/dashboard');
  });

  it.each([
    ['another auth route', '/auth/login'],
    ['a locale-prefixed auth route', '/en/auth/login'],
    ['a scheme', 'https://evil.com/auth/native/authorize?transaction=abc123'],
    ['a javascript scheme', 'javascript:alert(1)'],
    ['a protocol-relative path', '//evil.com'],
    ['a backslash protocol-relative path', '/\\evil.com'],
    ['a double slash inside the path', '/auth//native/authorize?transaction=abc123'],
    ['a backslash inside the path', '/auth\\native\\authorize?transaction=abc123'],
    ['a second locale prefix before an auth route', '/en/en/auth/login'],
    ['a second locale prefix before a path', '/en/en/dashboard'],
    ['a second locale prefix before a path', '/ar/ar/dashboard'], // feature:locale-ar
    ['a NUL character', '/dashboard\u0000'],
    ['a tab character', '/auth/native/authorize?transaction=a\tb'],
    ['a newline character', '/dashboard\n'],
    ['a DEL character', '/dashboard\u007f'],
    ['a parent segment', '/dashboard/../admin'],
    ['a parent segment reaching another host', '/..//evil.com'],
    ['a double slash in an ordinary path', '/dash//board'],
  ])('still rejects %s', (_label, candidate) => {
    expect(getRedirectPath(candidate)).toBe('/dashboard');
  });

  it('carries the continuation through signedInPath unchanged', () => {
    expect(signedInPath(null, ROUTE)).toBe(ROUTE);
    expect(signedInPath(null, `/ar${ROUTE}`)).toBe(ROUTE); // feature:locale-ar
  });

  it('carries the continuation into the two-factor page', () => {
    expect(twoFactorPath(ROUTE)).toBe(`/auth/2fa?redirect=${encodeURIComponent(ROUTE)}`);
  });
});
