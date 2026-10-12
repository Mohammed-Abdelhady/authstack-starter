import configuration from '../configuration';
import {
  INSECURE_ENVIRONMENT_WARNING,
  defaultSessionCookieName,
  startupEnvironmentWarning,
  usesSecureCookies,
} from './production-environment.util';

const HTTP = 'http://localhost:3000';
const HTTPS = 'https://app.example.com';

describe('cookie security by environment and address', () => {
  it.each([
    ['development', HTTP, false, 'sid'],
    ['development', HTTPS, true, '__Host-sid'],
    ['production', HTTPS, true, '__Host-sid'],
    ['production', HTTP, true, '__Host-sid'],
    [undefined, HTTPS, true, '__Host-sid'],
    [undefined, HTTP, false, 'sid'],
    ['test', undefined, false, 'sid'],
    ['development', 'not an address', false, 'sid'],
  ])(
    'NODE_ENV %s with client address %s',
    (nodeEnv, clientUrl, secure, name) => {
      expect(usesSecureCookies(nodeEnv, clientUrl)).toBe(secure);
      expect(defaultSessionCookieName(nodeEnv, clientUrl)).toBe(name);
    },
  );
});

describe('startupEnvironmentWarning', () => {
  it('warns when the address is https and the environment is not production', () => {
    expect(startupEnvironmentWarning('development', HTTPS)).toBe(
      INSECURE_ENVIRONMENT_WARNING,
    );
  });

  it.each([
    ['development', HTTP],
    ['production', HTTPS],
    ['test', undefined],
  ])('stays quiet for NODE_ENV %s with %s', (nodeEnv, clientUrl) => {
    expect(startupEnvironmentWarning(nodeEnv, clientUrl)).toBeUndefined();
  });
});

describe('the configured session cookie name', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  const cookieNameFor = (environment: Record<string, string>): string => {
    delete process.env.NODE_ENV;
    delete process.env.CLIENT_URL;
    delete process.env.SESSION_COOKIE_NAME;
    Object.assign(process.env, environment);
    return configuration().session.cookieName;
  };

  it('is host-bound on an https deployment that forgot NODE_ENV', () => {
    expect(cookieNameFor({ CLIENT_URL: HTTPS })).toBe('__Host-sid');
  });

  it('stays plain on http in development', () => {
    expect(cookieNameFor({ NODE_ENV: 'development', CLIENT_URL: HTTP })).toBe(
      'sid',
    );
  });

  it('keeps a configured name', () => {
    expect(
      cookieNameFor({ CLIENT_URL: HTTPS, SESSION_COOKIE_NAME: 'custom' }),
    ).toBe('custom');
  });
});
