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
  it.each([
    'https://APP.example.test:443/admin',
    'https://app.example.test/another-path',
  ])('refuses the same normalized client and admin origin: %s', (adminUrl) => {
    expect(() =>
      validateEnvironment({
        ...BASE_ENV,
        CLIENT_URL: 'https://app.example.test',
        ADMIN_URL: adminUrl,
      }),
    ).toThrow(/ADMIN_URL.*different origin.*CLIENT_URL/);
  });

  it.each(['http://admin.example.test', 'https://localhost:3001'])(
    'refuses an insecure or loopback production admin origin: %s',
    (adminUrl) => {
      expect(() =>
        validateEnvironment({
          ...BASE_ENV,
          NODE_ENV: 'production',
          CLIENT_URL: 'https://app.example.test',
          ADMIN_URL: adminUrl,
        }),
      ).toThrow(/ADMIN_URL.*public.*HTTPS/);
    },
  );

  it('accepts distinct public production browser origins', () => {
    expect(
      validateEnvironment({
        ...BASE_ENV,
        NODE_ENV: 'production',
        CLIENT_URL: 'https://app.example.test',
        ADMIN_URL: 'https://admin.example.test',
      }).ADMIN_URL,
    ).toBe('https://admin.example.test');
  });

  it.each(['AUTH_WEB_SIGN_IN', 'AUTH_ADMIN_SIGN_IN'] as const)(
    'accepts browser passkeys without native fields in %s',
    (setting) => {
      const raw = '{"passkeys":true,"signUp":"closed","audience":"staff"}';
      const validated = validateEnvironment({
        ...BASE_ENV,
        ADMIN_URL: 'http://localhost:3001',
        [setting]: raw,
      });
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
  describe('review access settings', () => {
    /** Start-up happens at this time. Thirty days later is the furthest end. */
    const STARTED = new Date('2030-01-01T00:00:00Z');
    const REVIEW = {
      EMAIL_CODE_REVIEW_ACCOUNT_ID: 'account',
      EMAIL_CODE_REVIEW_CLIENT_ID: 'mobile',
      // The shape of a bcrypt hash. Start-up reads the shape, never the code.
      EMAIL_CODE_REVIEW_CODE_HASH: `$2b$12$${'a'.repeat(53)}`,
      EMAIL_CODE_REVIEW_UNTIL: '2030-01-31T00:00:00.000Z',
    };

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(STARTED);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('accepts all four review settings, ending 30 days ahead, or none', () => {
      expect(
        validateEnvironment(BASE_ENV).EMAIL_CODE_REVIEW_UNTIL,
      ).toBeUndefined();
      expect(
        validateEnvironment({ ...BASE_ENV, ...REVIEW }).EMAIL_CODE_REVIEW_UNTIL,
      ).toBe('2030-01-31T00:00:00.000Z');
    });

    it.each([
      ['the account alone', ['EMAIL_CODE_REVIEW_ACCOUNT_ID']],
      [
        'all but the code',
        [
          'EMAIL_CODE_REVIEW_ACCOUNT_ID',
          'EMAIL_CODE_REVIEW_CLIENT_ID',
          'EMAIL_CODE_REVIEW_UNTIL',
        ],
      ],
      ['the end alone', ['EMAIL_CODE_REVIEW_UNTIL']],
    ])('refuses %s at start-up', (_case, settings) => {
      const partial = Object.fromEntries(
        Object.entries(REVIEW).filter(([name]) => settings.includes(name)),
      );

      expect(() => validateEnvironment({ ...BASE_ENV, ...partial })).toThrow(
        new RegExp(`- ${settings[0]}: .*set all four or none`),
      );
    });

    it('refuses a blank setting as one left out, since review access would be off', () => {
      expect(() =>
        validateEnvironment({
          ...BASE_ENV,
          ...REVIEW,
          EMAIL_CODE_REVIEW_CLIENT_ID: '   ',
        }),
      ).toThrow(/- EMAIL_CODE_REVIEW_CLIENT_ID: .*set all four or none/);
    });

    it('refuses a code hash that is not a bcrypt hash, such as the code itself', () => {
      expect(() =>
        validateEnvironment({
          ...BASE_ENV,
          ...REVIEW,
          EMAIL_CODE_REVIEW_CODE_HASH: '246810',
        }),
      ).toThrow(/- EMAIL_CODE_REVIEW_CODE_HASH: .*bcrypt hash/);
    });

    it('refuses an end more than 30 days ahead at start-up', () => {
      expect(() =>
        validateEnvironment({
          ...BASE_ENV,
          ...REVIEW,
          EMAIL_CODE_REVIEW_UNTIL: '2030-01-31T00:00:00.001Z',
        }),
      ).toThrow(/- EMAIL_CODE_REVIEW_UNTIL: .*at most 30 days ahead/);
    });
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

  // A previous key alone, or one equal to the current, could not read a
  // rotated token and would look like a rotation that never happened.
  it('refuses a previous provider key without a current key', () => {
    expect(() =>
      validateEnvironment({
        ...BASE_ENV,
        PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS: 'b'.repeat(32),
      }),
    ).toThrow(/PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS needs/);
  });

  it('refuses a previous provider key equal to the current key', () => {
    expect(() =>
      validateEnvironment({
        ...BASE_ENV,
        PROVIDER_TOKEN_ENCRYPTION_KEY: 'a'.repeat(32),
        PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS: 'a'.repeat(32),
      }),
    ).toThrow(/PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS needs/);
  });
});
