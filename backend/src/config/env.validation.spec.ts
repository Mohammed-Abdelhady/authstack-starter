import { validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  const STATE_SECRET = 'a'.repeat(32);
  const NATIVE_DPOP_NONCE_SECRET = 'native-dpop-test-secret-at-least-32-chars';

  const baseEnv: Record<string, unknown> = {
    NODE_ENV: 'test',
    MONGO_URI: 'mongodb://localhost:27017/authboiler', // feature:mongodb
    POSTGRES_URL: 'postgres://app:placeholder@localhost:5432/authboiler', // feature:postgres
    CLIENT_URL: 'http://localhost:3000',
    OAUTH_STATE_SECRET: STATE_SECRET,
  };

  it('valid env passes', () => {
    const result = validateEnvironment(baseEnv);

    expect(result.MONGO_URI).toBe('mongodb://localhost:27017/authboiler'); // feature:mongodb
    expect(result.NODE_ENV).toBe('test');
    expect(result.CLIENT_URL).toBe('http://localhost:3000');
    expect(result.PORT).toBe(3000);
  });

  // feature:mongodb:start
  it('missing MONGO_URI fails with its name in the message', () => {
    const envWithoutMongo: Record<string, unknown> = {
      NODE_ENV: 'test',
      CLIENT_URL: 'http://localhost:3000',
      OAUTH_STATE_SECRET: STATE_SECRET,
    };

    expect(() => validateEnvironment(envWithoutMongo)).toThrow(/MONGO_URI/);
  });
  // feature:mongodb:end

  it("SWAGGER_ENABLED='false' yields false", () => {
    const envWithSwaggerFalse: Record<string, unknown> = {
      ...baseEnv,
      SWAGGER_ENABLED: 'false',
    };

    const result = validateEnvironment(envWithSwaggerFalse);

    expect(result.SWAGGER_ENABLED).toBe(false);
  });

  // feature:mongodb:start
  it('mongodb+srv URI accepted', () => {
    const envWithAtlas: Record<string, unknown> = {
      ...baseEnv,
      MONGO_URI:
        'mongodb+srv://user:password@cluster0.mongodb.net/testdb?retryWrites=true&w=majority',
    };

    const result = validateEnvironment(envWithAtlas);

    expect(result.MONGO_URI).toBe(
      'mongodb+srv://user:password@cluster0.mongodb.net/testdb?retryWrites=true&w=majority',
    );
  });

  it('rejects invalid MONGO_URI protocol', () => {
    const envWithInvalidMongo: Record<string, unknown> = {
      ...baseEnv,
      MONGO_URI: 'http://localhost:27017/authboiler',
    };

    expect(() => validateEnvironment(envWithInvalidMongo)).toThrow(/MONGO_URI/);
  });
  // feature:mongodb:end

  it('parses numeric environment variables via Type transformer', () => {
    const envWithNumbers: Record<string, unknown> = {
      ...baseEnv,
      PORT: '5050',
      THROTTLE_TTL: '120',
      THROTTLE_LIMIT: '200',
    };

    const result = validateEnvironment(envWithNumbers);

    expect(result.PORT).toBe(5050);
    expect(result.THROTTLE_TTL).toBe(120);
    expect(result.THROTTLE_LIMIT).toBe(200);
  });

  // feature:oauth-core,passkeys:start
  it('missing OAUTH_STATE_SECRET fails with its name in the message', () => {
    const { OAUTH_STATE_SECRET: _omitted, ...envWithoutSecret } = baseEnv;

    expect(() => validateEnvironment(envWithoutSecret)).toThrow(
      /OAUTH_STATE_SECRET/,
    );
  });

  it('rejects a short OAUTH_STATE_SECRET', () => {
    const envWithShortSecret: Record<string, unknown> = {
      ...baseEnv,
      OAUTH_STATE_SECRET: 'too-short',
    };

    expect(() => validateEnvironment(envWithShortSecret)).toThrow(
      /at least 32 characters/,
    );
  });

  // feature:oauth-core,passkeys:end

  it('accepts API_URL and OAUTH_CALLBACK_BASE_URL', () => {
    const envWithUrls: Record<string, unknown> = {
      ...baseEnv,
      API_URL: 'http://localhost:5000',
      OAUTH_CALLBACK_BASE_URL: 'http://localhost:5000/api/auth/oauth',
    };

    const result = validateEnvironment(envWithUrls);

    expect(result.API_URL).toBe('http://localhost:5000');
    expect(result.OAUTH_CALLBACK_BASE_URL).toBe(
      'http://localhost:5000/api/auth/oauth',
    );
  });

  it('TWO_FACTOR_ENABLED defaults to true', () => {
    expect(validateEnvironment(baseEnv).TWO_FACTOR_ENABLED).toBe(true);
  });

  it("TWO_FACTOR_ENABLED='false' yields false", () => {
    const result = validateEnvironment({
      ...baseEnv,
      TWO_FACTOR_ENABLED: 'false',
    });

    expect(result.TWO_FACTOR_ENABLED).toBe(false);
  });

  it('boots without TOTP_ENCRYPTION_KEY', () => {
    expect(validateEnvironment(baseEnv).TOTP_ENCRYPTION_KEY).toBeUndefined();
  });

  it('accepts a 32 byte base64 TOTP_ENCRYPTION_KEY', () => {
    const key = Buffer.alloc(32, 7).toString('base64');

    expect(
      validateEnvironment({ ...baseEnv, TOTP_ENCRYPTION_KEY: key })
        .TOTP_ENCRYPTION_KEY,
    ).toBe(key);
  });

  it('reads a blank TOTP_ENCRYPTION_KEY as unset', () => {
    const result = validateEnvironment({
      ...baseEnv,
      TOTP_ENCRYPTION_KEY: '',
    });

    expect(result.TOTP_ENCRYPTION_KEY).toBeUndefined();
  });

  it('rejects a TOTP_ENCRYPTION_KEY that is not 32 bytes', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        TOTP_ENCRYPTION_KEY: Buffer.alloc(16, 7).toString('base64'),
      }),
    ).toThrow(/TOTP_ENCRYPTION_KEY/);
  });

  it('AUTH_EPOCH defaults to 1 and AUTH_NATIVE_ENABLED defaults to false', () => {
    const result = validateEnvironment(baseEnv);

    expect(result.AUTH_EPOCH).toBe(1);
    expect(result.AUTH_NATIVE_ENABLED).toBe(false);
    expect(result.AUTH_NATIVE_DPOP_REQUIRED).toBe(false);
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('parses AUTH_NATIVE_DPOP_REQUIRED=%s as %s', (value, expected) => {
    const result = validateEnvironment({
      ...baseEnv,
      AUTH_NATIVE_DPOP_REQUIRED: value,
    });

    expect(result.AUTH_NATIVE_DPOP_REQUIRED).toBe(expected);
  });

  it('rejects an invalid AUTH_NATIVE_DPOP_REQUIRED value', () => {
    expect(() =>
      validateEnvironment({ ...baseEnv, AUTH_NATIVE_DPOP_REQUIRED: 'yes' }),
    ).toThrow(/AUTH_NATIVE_DPOP_REQUIRED/);
  });

  it.each(['0x10', '1e3', '0', '-1', ' 2 '])(
    'rejects AUTH_EPOCH=%j',
    (epoch) => {
      expect(() =>
        validateEnvironment({ ...baseEnv, AUTH_EPOCH: epoch }),
      ).toThrow(/AUTH_EPOCH/);
    },
  );

  it("accepts AUTH_EPOCH='7' as the number 7", () => {
    const result = validateEnvironment({ ...baseEnv, AUTH_EPOCH: '7' });

    expect(result.AUTH_EPOCH).toBe(7);
  });

  it("AUTH_NATIVE_ENABLED='true' yields true", () => {
    const result = validateEnvironment({
      ...baseEnv,
      AUTH_NATIVE_ENABLED: 'true',
      AUTH_NATIVE_DPOP_NONCE_SECRET: NATIVE_DPOP_NONCE_SECRET,
      API_URL: 'https://api.example.test',
    });

    expect(result.AUTH_NATIVE_ENABLED).toBe(true);
    expect(result.AUTH_NATIVE_DPOP_NONCE_SECRET).toBe(NATIVE_DPOP_NONCE_SECRET);
  });

  it('requires the DPoP nonce secret when native auth is enabled', () => {
    expect(() =>
      validateEnvironment({ ...baseEnv, AUTH_NATIVE_ENABLED: 'true' }),
    ).toThrow(/AUTH_NATIVE_DPOP_NONCE_SECRET/);
  });

  it('rejects a short DPoP nonce secret when native auth is enabled', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        AUTH_NATIVE_ENABLED: 'true',
        AUTH_NATIVE_DPOP_NONCE_SECRET: 'too-short',
      }),
    ).toThrow(/AUTH_NATIVE_DPOP_NONCE_SECRET/);
  });

  it('rejects a DPoP nonce secret one character below the minimum', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        AUTH_NATIVE_ENABLED: 'true',
        AUTH_NATIVE_DPOP_NONCE_SECRET: 'n'.repeat(31),
      }),
    ).toThrow(/AUTH_NATIVE_DPOP_NONCE_SECRET/);
  });

  it('accepts native auth disabled without a DPoP nonce secret', () => {
    const result = validateEnvironment({
      ...baseEnv,
      AUTH_NATIVE_ENABLED: 'false',
    });

    expect(result.AUTH_NATIVE_ENABLED).toBe(false);
    expect(result.AUTH_NATIVE_DPOP_NONCE_SECRET).toBeUndefined();
  });

  it('AUTH_NATIVE_ALLOW_CUSTOM_SCHEME defaults to false', () => {
    expect(validateEnvironment(baseEnv).AUTH_NATIVE_ALLOW_CUSTOM_SCHEME).toBe(
      false,
    );
  });

  it("AUTH_NATIVE_ALLOW_CUSTOM_SCHEME='true' yields true", () => {
    const result = validateEnvironment({
      ...baseEnv,
      AUTH_NATIVE_ALLOW_CUSTOM_SCHEME: 'true',
    });

    expect(result.AUTH_NATIVE_ALLOW_CUSTOM_SCHEME).toBe(true);
  });

  it('parses the mail dispatcher bounds', () => {
    const result = validateEnvironment({
      ...baseEnv,
      MAIL_MAX_PENDING_SENDS: '50',
      MAIL_DRAIN_DEADLINE_MS: '2500',
    });

    expect(result.MAIL_MAX_PENDING_SENDS).toBe(50);
    expect(result.MAIL_DRAIN_DEADLINE_MS).toBe(2500);
  });

  it.each([
    { key: 'MAIL_MAX_PENDING_SENDS', value: '0' },
    { key: 'MAIL_MAX_PENDING_SENDS', value: '10001' },
    { key: 'MAIL_DRAIN_DEADLINE_MS', value: '99' },
    { key: 'MAIL_DRAIN_DEADLINE_MS', value: '60001' },
  ])('rejects $key=$value outside its bounds', ({ key, value }) => {
    expect(() => validateEnvironment({ ...baseEnv, [key]: value })).toThrow(
      new RegExp(key),
    );
  });
});
