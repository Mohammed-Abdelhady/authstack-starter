import { validateEnvironment } from './env.validation';
import configuration from './configuration';
import { parseBrowserSignIn } from './utils/host-policy-config.util';

const BASE_ENV = {
  NODE_ENV: 'test',
  MONGO_URI: 'mongodb://localhost:27017/authboiler', // feature:mongodb
  POSTGRES_URL: 'postgres://app:placeholder@localhost:5432/authboiler', // feature:postgres
  CLIENT_URL: 'http://localhost:3000',
  OAUTH_STATE_SECRET: 's'.repeat(32),
};

describe('reserved host settings validation', () => {
  it('accepts ADMIN_URL equal to CLIENT_URL at startup', () => {
    expect(
      validateEnvironment({ ...BASE_ENV, ADMIN_URL: 'http://localhost:3000' })
        .ADMIN_URL,
    ).toBe('http://localhost:3000');
  });

  it('accepts a reserved http ADMIN_URL in production', () => {
    expect(
      validateEnvironment({
        ...BASE_ENV,
        NODE_ENV: 'production',
        CLIENT_URL: 'https://app.example.com',
        ADMIN_URL: 'http://localhost:3001',
      }).ADMIN_URL,
    ).toBe('http://localhost:3001');
  });

  it.each(['AUTH_WEB_SIGN_IN', 'AUTH_ADMIN_SIGN_IN'] as const)(
    'accepts browser passkeys without native fields in %s',
    (setting) => {
      const raw = '{"passkeys":true,"signUp":"closed","audience":"staff"}';
      const validated = validateEnvironment({ ...BASE_ENV, [setting]: raw });
      expect(parseBrowserSignIn(validated[setting], setting)).toEqual({
        passkeys: true,
        signUp: 'closed',
        audience: 'staff',
      });
    },
  );

  it.each([
    ['AUTH_WEB_SIGN_IN', '{"providers":[]}'],
    ['AUTH_WEB_SIGN_IN', '{"signUp":"invite-only"}'],
    ['AUTH_ADMIN_SIGN_IN', '{"requirePasskey":"true"}'],
    ['AUTH_WEB_SIGN_IN', '{"audience":"unknown"}'],
    ['AUTH_ADMIN_SIGN_IN', '[]'],
    ['AUTH_WEB_SIGN_IN', '{'],
  ])('refuses invalid browser policy %s = %s', (setting, raw) => {
    expect(() => validateEnvironment({ ...BASE_ENV, [setting]: raw })).toThrow(
      new RegExp(setting),
    );
    expect(() => parseBrowserSignIn(raw, setting)).toThrow(
      new RegExp(`^${setting}`),
    );
  });

  it('reports the invalid browser policy key at startup', () => {
    expect(() =>
      validateEnvironment({
        ...BASE_ENV,
        AUTH_ADMIN_SIGN_IN: '{"passkeys":"true"}',
      }),
    ).toThrow('AUTH_ADMIN_SIGN_IN.passkeys must be boolean');
  });

  // feature:email-code:start
  const REVIEW = {
    EMAIL_CODE_REVIEW_ACCOUNT_ID: 'account',
    EMAIL_CODE_REVIEW_CLIENT_ID: 'mobile',
    EMAIL_CODE_REVIEW_CODE_HASH: 'digest',
    EMAIL_CODE_REVIEW_UNTIL: '2030-01-31T00:00:00.000Z',
  };

  it('accepts absent or complete review settings', () => {
    expect(
      validateEnvironment(BASE_ENV).EMAIL_CODE_REVIEW_UNTIL,
    ).toBeUndefined();
    expect(
      validateEnvironment({ ...BASE_ENV, ...REVIEW }).EMAIL_CODE_REVIEW_UNTIL,
    ).toBe('2030-01-31T00:00:00.000Z');
  });

  it('accepts a review field without the other review settings', () => {
    expect(
      validateEnvironment({
        ...BASE_ENV,
        EMAIL_CODE_REVIEW_ACCOUNT_ID: 'account',
      }).EMAIL_CODE_REVIEW_ACCOUNT_ID,
    ).toBe('account');
  });

  it('accepts a review deadline beyond 30 days at startup', () => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00Z'));
    try {
      expect(
        validateEnvironment({
          ...BASE_ENV,
          ...REVIEW,
          EMAIL_CODE_REVIEW_UNTIL: '2030-01-31T00:00:00.001Z',
        }).EMAIL_CODE_REVIEW_UNTIL,
      ).toBe('2030-01-31T00:00:00.001Z');
    } finally {
      jest.useRealTimers();
    }
  });
  // feature:email-code:end

  it('keeps immediate erasure distinct from disabled erasure', () => {
    expect(
      validateEnvironment(BASE_ENV).ACCOUNT_ERASE_GRACE_DAYS,
    ).toBeUndefined();
    expect(
      validateEnvironment({ ...BASE_ENV, ACCOUNT_ERASE_GRACE_DAYS: ' ' })
        .ACCOUNT_ERASE_GRACE_DAYS,
    ).toBeUndefined();
    expect(
      validateEnvironment({ ...BASE_ENV, ACCOUNT_ERASE_GRACE_DAYS: '0' })
        .ACCOUNT_ERASE_GRACE_DAYS,
    ).toBe(0);
    const previous = process.env.ACCOUNT_ERASE_GRACE_DAYS;
    try {
      delete process.env.ACCOUNT_ERASE_GRACE_DAYS;
      expect(configuration().account.eraseGraceDays).toBeUndefined();
      process.env.ACCOUNT_ERASE_GRACE_DAYS = ' ';
      expect(configuration().account.eraseGraceDays).toBeUndefined();
      process.env.ACCOUNT_ERASE_GRACE_DAYS = '0';
      expect(configuration().account.eraseGraceDays).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.ACCOUNT_ERASE_GRACE_DAYS;
      else process.env.ACCOUNT_ERASE_GRACE_DAYS = previous;
    }
  });

  it.each(['-1', '0.5'])('refuses an erase grace of %s', (value) => {
    expect(() =>
      validateEnvironment({ ...BASE_ENV, ACCOUNT_ERASE_GRACE_DAYS: value }),
    ).toThrow(/ACCOUNT_ERASE_GRACE_DAYS/);
  });

  it('accepts distinct provider keys at the minimum length', () => {
    const validated = validateEnvironment({
      ...BASE_ENV,
      PROVIDER_TOKEN_ENCRYPTION_KEY: 'a'.repeat(32),
      PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS: 'b'.repeat(32),
    });
    expect(validated.PROVIDER_TOKEN_ENCRYPTION_KEY).toBe('a'.repeat(32));
    expect(validated.PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS).toBe(
      'b'.repeat(32),
    );
  });

  it.each([
    'PROVIDER_TOKEN_ENCRYPTION_KEY',
    'PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS',
  ])('refuses a short provider key in %s', (setting) => {
    expect(() =>
      validateEnvironment({
        ...BASE_ENV,
        PROVIDER_TOKEN_ENCRYPTION_KEY: 'a'.repeat(32),
        [setting]: 'b'.repeat(31),
      }),
    ).toThrow(new RegExp(setting));
  });

  it('accepts a previous provider key without a current key', () => {
    expect(
      validateEnvironment({
        ...BASE_ENV,
        PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS: 'b'.repeat(32),
      }).PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS,
    ).toBe('b'.repeat(32));
  });

  it('accepts a previous provider key equal to the current key', () => {
    expect(
      validateEnvironment({
        ...BASE_ENV,
        PROVIDER_TOKEN_ENCRYPTION_KEY: 'a'.repeat(32),
        PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS: 'a'.repeat(32),
      }).PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS,
    ).toBe('a'.repeat(32));
  });
});
