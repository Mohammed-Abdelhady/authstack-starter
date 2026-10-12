import { validateEnvironment } from './env.validation';

const NATIVE_DPOP_NONCE_SECRET = 'native-dpop-test-secret-at-least-32-chars';

const baseEnv: Record<string, unknown> = {
  NODE_ENV: 'test',
  MONGO_URI: 'mongodb://localhost:27017/authboiler', // feature:mongodb
  POSTGRES_URL: 'postgres://app:placeholder@localhost:5432/authboiler', // feature:postgres
  CLIENT_URL: 'http://localhost:3000',
  OAUTH_STATE_SECRET: 'a'.repeat(32),
};

const nativeEnv: Record<string, unknown> = {
  ...baseEnv,
  AUTH_NATIVE_ENABLED: 'true',
  AUTH_NATIVE_DPOP_NONCE_SECRET: NATIVE_DPOP_NONCE_SECRET,
};

describe('API_URL with native sign-in enabled', () => {
  it.each([
    ['is unset', undefined],
    ['is blank', ''],
    ['has no scheme', 'api.example.com'],
    ['uses another scheme', 'ftp://api.example.com'],
    ['carries the api path', 'https://api.example.com/api'],
    ['carries a path prefix ending in a slash', 'https://api.example.com/v2/'],
    ['normalizes a path to the root', 'https://api.example.com/api/..'],
    [
      'normalizes an encoded path to the root',
      'https://api.example.com/api/%2e%2e',
    ],
    ['carries a query', 'https://api.example.com/?region=eu'],
    ['carries a fragment', 'https://api.example.com/#top'],
    ['carries credentials', 'https://user:pass@api.example.com'],
  ])('refuses to start when it %s', (_name, apiUrl) => {
    expect(() =>
      validateEnvironment({ ...nativeEnv, API_URL: apiUrl }),
    ).toThrow(/- API_URL: /);
  });

  it.each([
    ['an https origin', 'https://api.example.com'],
    ['an https origin with a trailing slash', 'https://api.example.com/'],
    ['an https origin with a port', 'https://api.example.com:8443'],
    ['an http origin outside production', 'http://localhost:5000'],
  ])('accepts %s', (_name, apiUrl) => {
    expect(validateEnvironment({ ...nativeEnv, API_URL: apiUrl }).API_URL).toBe(
      apiUrl,
    );
  });

  it('refuses an http origin in production', () => {
    expect(() =>
      validateEnvironment({
        ...nativeEnv,
        NODE_ENV: 'production',
        API_URL: 'http://api.example.com',
      }),
    ).toThrow(/- API_URL: /);
  });

  it('accepts an https origin in production', () => {
    const result = validateEnvironment({
      ...nativeEnv,
      NODE_ENV: 'production',
      CLIENT_URL: 'https://app.example.com',
      API_URL: 'https://api.example.com',
    });

    expect(result.API_URL).toBe('https://api.example.com');
  });
});

describe('API_URL with native sign-in disabled', () => {
  it('stays optional', () => {
    expect(validateEnvironment(baseEnv).API_URL).toBeUndefined();
  });

  it('keeps accepting an address with a path', () => {
    const result = validateEnvironment({
      ...baseEnv,
      API_URL: 'http://localhost:5000/api',
    });

    expect(result.API_URL).toBe('http://localhost:5000/api');
  });

  it('still refuses a value that is not an address', () => {
    expect(() =>
      validateEnvironment({ ...baseEnv, API_URL: 'not an address' }),
    ).toThrow(/- API_URL: /);
  });
});
