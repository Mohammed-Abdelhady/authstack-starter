import { describe, expect, it } from 'vitest';

import { resolveConfig, resolveKeyProtection } from '../src/logic/resolve-config';

describe('app configuration', () => {
  it('points a development build at the local server when no origin is set', () => {
    expect(
      resolveConfig({ apiOrigin: undefined, development: true, scheme: 'com.example.mobile' }),
    ).toEqual({
      serverBaseAddress: 'http://localhost:5001',
      environment: 'development',
      clientId: 'com.example.mobile',
      redirectUri: 'com.example.mobile://oauth/callback',
      scopes: ['api'],
    });
  });

  it.each([[''], ['   ']])('treats the origin %j as not set', (apiOrigin) => {
    expect(
      resolveConfig({ apiOrigin, development: true, scheme: 'com.example.mobile' })
        .serverBaseAddress,
    ).toBe('http://localhost:5001');
  });

  it('uses the configured origin, trimmed', () => {
    const config = resolveConfig({
      apiOrigin: ' https://api.example.test ',
      development: false,
      scheme: 'com.example.mobile',
    });

    expect(config.serverBaseAddress).toBe('https://api.example.test');
    expect(config.environment).toBe('production');
  });

  it('refuses to start a release build with no origin', () => {
    expect(() =>
      resolveConfig({ apiOrigin: undefined, development: false, scheme: 'com.example.mobile' }),
    ).toThrow('EXPO_PUBLIC_API_ORIGIN is not set.');
  });

  it('lets only a development build sign with a software key', () => {
    expect(resolveKeyProtection(true)).toBe('softwareAllowed');
    expect(resolveKeyProtection(false)).toBe('hardwareOnly');
  });
});
