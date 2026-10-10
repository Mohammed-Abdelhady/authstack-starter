import { validateEnvironment } from './env.validation';

describe('the PostgreSQL address and pool', () => {
  const postgresEnv: Record<string, unknown> = {
    NODE_ENV: 'test',
    DATABASE_TYPE: 'postgres', // feature:database-choice
    POSTGRES_URL: 'postgres://app:placeholder@localhost:5432/authboiler',
    CLIENT_URL: 'http://localhost:3000',
    OAUTH_STATE_SECRET: 'a'.repeat(32),
  };

  it('takes the address as given and ten connections when none is named', () => {
    const result = validateEnvironment(postgresEnv);

    expect({
      url: result.POSTGRES_URL,
      poolMax: result.POSTGRES_POOL_MAX,
    }).toEqual({
      url: 'postgres://app:placeholder@localhost:5432/authboiler',
      poolMax: 10,
    });
  });

  it('accepts the postgresql scheme', () => {
    const url = 'postgresql://app:placeholder@db.internal/authboiler';

    expect(
      validateEnvironment({ ...postgresEnv, POSTGRES_URL: url }).POSTGRES_URL,
    ).toBe(url);
  });

  it('refuses a missing address and names the setting', () => {
    const { POSTGRES_URL: _omitted, ...withoutAddress } = postgresEnv;

    expect(() => validateEnvironment(withoutAddress)).toThrow(/POSTGRES_URL/);
  });

  it.each([
    ['blank', ''],
    ['another database', 'mysql://app@localhost/authboiler'],
    ['a bare scheme', 'postgres://'],
  ])('refuses %s as the address and names the setting', (_, url) => {
    expect(() =>
      validateEnvironment({ ...postgresEnv, POSTGRES_URL: url }),
    ).toThrow(/POSTGRES_URL/);
  });

  it.each([
    ['1', 1],
    ['200', 200],
    ['', 10],
  ])('takes %p as the pool size', (given, expected) => {
    expect(
      validateEnvironment({ ...postgresEnv, POSTGRES_POOL_MAX: given })
        .POSTGRES_POOL_MAX,
    ).toBe(expected);
  });

  it.each([['0'], ['201'], ['2.5'], ['many']])(
    'refuses %p as the pool size and names the setting',
    (given) => {
      expect(() =>
        validateEnvironment({ ...postgresEnv, POSTGRES_POOL_MAX: given }),
      ).toThrow(/POSTGRES_POOL_MAX/);
    },
  );
});
