import { validateEnvironment } from './env.validation';

describe('passkey challenge environment', () => {
  const baseEnv: Record<string, unknown> = {
    NODE_ENV: 'test',
    MONGO_URI: 'mongodb://localhost:27017/authboiler', // feature:mongodb
    POSTGRES_URL: 'postgres://app:placeholder@localhost:5432/authboiler', // feature:postgres
    CLIENT_URL: 'http://localhost:3000',
    OAUTH_STATE_SECRET: 'a'.repeat(32),
  };

  it('accepts a dedicated passkey challenge key and a distinct previous key', () => {
    const result = validateEnvironment({
      ...baseEnv,
      PASSKEY_CHALLENGE_SECRET: 'n'.repeat(32),
      PASSKEY_CHALLENGE_SECRET_PREVIOUS: 'p'.repeat(32),
    });
    expect(result.PASSKEY_CHALLENGE_SECRET).toBe('n'.repeat(32));
    expect(result.PASSKEY_CHALLENGE_SECRET_PREVIOUS).toBe('p'.repeat(32));
  });

  it('rejects short or identical dedicated passkey challenge keys', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        PASSKEY_CHALLENGE_SECRET: 'short',
      }),
    ).toThrow(/PASSKEY_CHALLENGE_SECRET/);
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        PASSKEY_CHALLENGE_SECRET: 'n'.repeat(32),
        PASSKEY_CHALLENGE_SECRET_PREVIOUS: 'n'.repeat(32),
      }),
    ).toThrow(/PASSKEY_CHALLENGE_SECRET_PREVIOUS/);
  });

  it('rejects reuse of the OAuth state secret as a dedicated key', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        PASSKEY_CHALLENGE_SECRET: baseEnv.OAUTH_STATE_SECRET,
      }),
    ).toThrow(/PASSKEY_CHALLENGE_SECRET/);
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        PASSKEY_CHALLENGE_SECRET: 'n'.repeat(32),
        PASSKEY_CHALLENGE_SECRET_PREVIOUS: baseEnv.OAUTH_STATE_SECRET,
      }),
    ).toThrow(/PASSKEY_CHALLENGE_SECRET_PREVIOUS/);
  });

  it('bounds the legacy passkey challenge fallback to five minutes', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        PASSKEY_CHALLENGE_SECRET: 'n'.repeat(32),
        PASSKEY_CHALLENGE_LEGACY_UNTIL: new Date(
          Date.now() + 600_000,
        ).toISOString(),
      }),
    ).toThrow(/PASSKEY_CHALLENGE_LEGACY_UNTIL/);
  });
});
