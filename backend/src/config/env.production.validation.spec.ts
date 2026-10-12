import { validateEnvironment } from './env.validation';

const productionEnv: Record<string, unknown> = {
  NODE_ENV: 'production',
  MONGO_URI: 'mongodb://db.internal:27017/authboiler', // feature:mongodb
  POSTGRES_URL: 'postgres://app:placeholder@db.internal:5432/authboiler', // feature:postgres
  CLIENT_URL: 'https://app.example.com',
  OAUTH_STATE_SECRET: 'a'.repeat(32),
};

const developmentEnv: Record<string, unknown> = {
  ...productionEnv,
  NODE_ENV: 'development',
  CLIENT_URL: 'http://localhost:3000',
};

describe('a production start', () => {
  it('accepts an https client address on a public host', () => {
    expect(validateEnvironment(productionEnv).CLIENT_URL).toBe(
      'https://app.example.com',
    );
  });

  describe('CLIENT_URL', () => {
    it.each([
      ['is http', 'http://app.example.com'],
      ['is localhost', 'https://localhost:3000'],
      ['is a name under localhost', 'https://app.localhost'],
      ['is a loopback IPv4 address', 'https://127.0.0.1'],
      ['is another address in the loopback range', 'https://127.8.4.2:3000'],
      ['is the loopback IPv6 address', 'https://[::1]:3000'],
      ['is the unspecified address', 'https://0.0.0.0'],
    ])('refuses to start when it %s', (_name, clientUrl) => {
      expect(() =>
        validateEnvironment({ ...productionEnv, CLIENT_URL: clientUrl }),
      ).toThrow(/- CLIENT_URL: CLIENT_URL must be an https address/);
    });

    it('refuses to start when it is left at its development default', () => {
      const withoutClientUrl = { ...productionEnv };
      delete withoutClientUrl.CLIENT_URL;

      expect(() => validateEnvironment(withoutClientUrl)).toThrow(
        /- CLIENT_URL: /,
      );
    });

    it.each([
      ['http on localhost', 'http://localhost:3000'],
      ['https on localhost', 'https://localhost:3000'],
      ['http on a public host', 'http://staging.example.com'],
    ])('accepts %s outside production', (_name, clientUrl) => {
      const result = validateEnvironment({
        ...developmentEnv,
        CLIENT_URL: clientUrl,
      });

      expect(result.CLIENT_URL).toBe(clientUrl);
    });
  });

  describe('API_URL', () => {
    it.each([
      ['is http', 'http://api.example.com'],
      ['is localhost', 'https://localhost:5000'],
      ['is a loopback address', 'https://127.0.0.1:5000'],
    ])('refuses to start when it %s', (_name, apiUrl) => {
      expect(() =>
        validateEnvironment({ ...productionEnv, API_URL: apiUrl }),
      ).toThrow(/- API_URL: .*API_URL must be an https address/);
    });

    it('accepts an https address on a public host', () => {
      const result = validateEnvironment({
        ...productionEnv,
        API_URL: 'https://api.example.com',
      });

      expect(result.API_URL).toBe('https://api.example.com');
    });

    it('stays optional', () => {
      expect(validateEnvironment(productionEnv).API_URL).toBeUndefined();
    });

    it('accepts http on localhost outside production', () => {
      const result = validateEnvironment({
        ...developmentEnv,
        API_URL: 'http://localhost:5000',
      });

      expect(result.API_URL).toBe('http://localhost:5000');
    });
  });

  describe('Swagger', () => {
    it('refuses SWAGGER_ENABLED on its own', () => {
      expect(() =>
        validateEnvironment({ ...productionEnv, SWAGGER_ENABLED: 'true' }),
      ).toThrow(/- SWAGGER_ENABLED: .*SWAGGER_ALLOW_IN_PRODUCTION=true/);
    });

    it('refuses SWAGGER_ENABLED when the second setting says no', () => {
      expect(() =>
        validateEnvironment({
          ...productionEnv,
          SWAGGER_ENABLED: 'true',
          SWAGGER_ALLOW_IN_PRODUCTION: 'false',
        }),
      ).toThrow(/- SWAGGER_ENABLED: /);
    });

    it('accepts SWAGGER_ENABLED once the second setting allows it', () => {
      const result = validateEnvironment({
        ...productionEnv,
        SWAGGER_ENABLED: 'true',
        SWAGGER_ALLOW_IN_PRODUCTION: 'true',
      });

      expect(result.SWAGGER_ENABLED).toBe(true);
      expect(result.SWAGGER_ALLOW_IN_PRODUCTION).toBe(true);
    });

    it('does not turn Swagger on from the second setting alone', () => {
      const result = validateEnvironment({
        ...productionEnv,
        SWAGGER_ALLOW_IN_PRODUCTION: 'true',
      });

      expect(result.SWAGGER_ENABLED).toBe(false);
    });

    it('leaves the second setting off by default', () => {
      expect(
        validateEnvironment(productionEnv).SWAGGER_ALLOW_IN_PRODUCTION,
      ).toBe(false);
    });

    it('accepts SWAGGER_ENABLED on its own outside production', () => {
      const result = validateEnvironment({
        ...developmentEnv,
        SWAGGER_ENABLED: 'true',
      });

      expect(result.SWAGGER_ENABLED).toBe(true);
    });
  });

  describe('seed settings', () => {
    const SEED_SETTINGS = [
      ['SEED_ADMIN_PASSWORD', 'known-admin-password'],
      ['SEED_USER_PASSWORD', 'known-user-password'],
      ['SEED_PRINT_PASSWORDS', 'true'],
      ['SEED_PASSWORD_FILE', '.seed-passwords'],
    ] as const;

    it.each(SEED_SETTINGS)('refuses to start with %s set', (name, value) => {
      expect(() =>
        validateEnvironment({ ...productionEnv, [name]: value }),
      ).toThrow(new RegExp(`- ${name}: ${name} is a development setting`));
    });

    it.each(SEED_SETTINGS)('reads a blank %s as unset', (name) => {
      expect(() =>
        validateEnvironment({ ...productionEnv, [name]: '' }),
      ).not.toThrow();
    });

    it.each(SEED_SETTINGS)('accepts %s outside production', (name, value) => {
      expect(() =>
        validateEnvironment({ ...developmentEnv, [name]: value }),
      ).not.toThrow();
    });
  });

  describe('the global rate limit', () => {
    it('accepts the default limit', () => {
      const result = validateEnvironment(productionEnv);

      expect(result.THROTTLE_LIMIT).toBe(60);
      expect(result.THROTTLE_TTL).toBe(60);
    });

    it('accepts 20 requests a second, the most a production server allows', () => {
      const result = validateEnvironment({
        ...productionEnv,
        THROTTLE_TTL: '10',
        THROTTLE_LIMIT: '200',
      });

      expect(result.THROTTLE_LIMIT).toBe(200);
    });

    it('refuses one request above that', () => {
      expect(() =>
        validateEnvironment({
          ...productionEnv,
          THROTTLE_TTL: '10',
          THROTTLE_LIMIT: '201',
        }),
      ).toThrow(/- THROTTLE_LIMIT: THROTTLE_LIMIT must not exceed 20 requests/);
    });

    it('refuses a limit that switches limiting off in practice', () => {
      expect(() =>
        validateEnvironment({
          ...productionEnv,
          THROTTLE_TTL: '1',
          THROTTLE_LIMIT: '1000',
        }),
      ).toThrow(/- THROTTLE_LIMIT: /);
    });

    it('accepts the same limit outside production', () => {
      const result = validateEnvironment({
        ...developmentEnv,
        THROTTLE_TTL: '1',
        THROTTLE_LIMIT: '1000',
      });

      expect(result.THROTTLE_LIMIT).toBe(1000);
    });
  });
});
