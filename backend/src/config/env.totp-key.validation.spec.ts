import { validateEnvironment } from './env.validation';

const BASE: Record<string, unknown> = {
  NODE_ENV: 'test',
  MONGO_URI: 'mongodb://localhost:27017/authboiler', // feature:mongodb
  POSTGRES_URL: 'postgres://app:placeholder@localhost:5432/authboiler', // feature:postgres
  CLIENT_URL: 'http://localhost:3000',
  OAUTH_STATE_SECRET: 'a'.repeat(32),
};
/** 32 bytes of 0x07 in base64, written out. */
const KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=';
/** 16 bytes of 0x07 in base64. */
const SHORT_KEY = 'BwcHBwcHBwcHBwcHBwcHBw==';

describe('the previous TOTP encryption key a server may start with', () => {
  it('is absent unless it is set', () => {
    expect(
      validateEnvironment(BASE).TOTP_ENCRYPTION_KEY_PREVIOUS,
    ).toBeUndefined();
  });

  it('is kept when it is 32 bytes in base64', () => {
    expect(
      validateEnvironment({ ...BASE, TOTP_ENCRYPTION_KEY_PREVIOUS: KEY })
        .TOTP_ENCRYPTION_KEY_PREVIOUS,
    ).toBe(KEY);
  });

  it('reads a blank value as unset', () => {
    expect(
      validateEnvironment({ ...BASE, TOTP_ENCRYPTION_KEY_PREVIOUS: '' })
        .TOTP_ENCRYPTION_KEY_PREVIOUS,
    ).toBeUndefined();
  });

  it.each([SHORT_KEY, 'not base64 at all', `${KEY}=`])(
    'refuses %p and names the setting',
    (value) => {
      expect(() =>
        validateEnvironment({ ...BASE, TOTP_ENCRYPTION_KEY_PREVIOUS: value }),
      ).toThrow(/TOTP_ENCRYPTION_KEY_PREVIOUS must be 32 bytes/);
    },
  );
});
