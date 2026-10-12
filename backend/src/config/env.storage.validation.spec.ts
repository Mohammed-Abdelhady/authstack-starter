import { validateEnvironment } from './env.validation';

describe('the database settings', () => {
  const base: Record<string, unknown> = {
    NODE_ENV: 'test',
    CLIENT_URL: 'http://localhost:3000',
    OAUTH_STATE_SECRET: 'a'.repeat(32),
  };
  const MONGO_URI = 'mongodb://localhost:27017/authboiler';
  const POSTGRES_URL = 'postgres://app:placeholder@localhost:5432/authboiler';

  function refusal(environment: Record<string, unknown>): string {
    try {
      validateEnvironment(environment);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    return 'accepted';
  }

  it('runs on MongoDB when the setting is absent or blank', () => {
    const absent = validateEnvironment({ ...base, MONGO_URI });
    const blank = validateEnvironment({
      ...base,
      MONGO_URI,
      DATABASE_TYPE: '',
    });

    expect({
      absent: absent.DATABASE_TYPE,
      blankStillNeedsMongo: refusal({ ...base, DATABASE_TYPE: '' }).includes(
        'MONGO_URI',
      ),
      blankAccepted: blank.MONGO_URI,
    }).toEqual({
      absent: 'mongodb',
      blankStillNeedsMongo: true,
      blankAccepted: MONGO_URI,
    });
  });

  it('takes PostgreSQL with its address and asks for no MongoDB address', () => {
    const validated = validateEnvironment({
      ...base,
      DATABASE_TYPE: 'postgres',
      POSTGRES_URL,
    });

    expect({
      kind: validated.DATABASE_TYPE,
      url: validated.POSTGRES_URL,
      poolMax: validated.POSTGRES_POOL_MAX,
    }).toEqual({ kind: 'postgres', url: POSTGRES_URL, poolMax: 10 });
  });

  it('accepts the postgresql scheme as well', () => {
    const url = 'postgresql://app:placeholder@db.internal/authboiler';

    expect(
      validateEnvironment({
        ...base,
        DATABASE_TYPE: 'postgres',
        POSTGRES_URL: url,
      }).POSTGRES_URL,
    ).toBe(url);
  });

  it.each([
    ['missing', undefined],
    ['blank', ''],
    ['another database', 'mysql://app@localhost/authboiler'],
    ['a MongoDB address', MONGO_URI],
    ['a bare scheme', 'postgres://'],
  ])('refuses PostgreSQL with a %s address and names the setting', (_, url) => {
    const environment: Record<string, unknown> = {
      ...base,
      DATABASE_TYPE: 'postgres',
      MONGO_URI,
    };
    if (url !== undefined) environment.POSTGRES_URL = url;

    expect(refusal(environment)).toMatch(/POSTGRES_URL/);
  });

  it('does not read the PostgreSQL settings on MongoDB', () => {
    const validated = validateEnvironment({
      ...base,
      MONGO_URI,
      DATABASE_TYPE: 'mongodb',
      POSTGRES_URL: 'not an address',
      POSTGRES_POOL_MAX: 'many',
    });

    expect(validated.DATABASE_TYPE).toBe('mongodb');
  });

  it('still refuses a missing MongoDB address on MongoDB, with PostgreSQL settings present', () => {
    expect(
      refusal({ ...base, DATABASE_TYPE: 'mongodb', POSTGRES_URL }),
    ).toMatch(/MONGO_URI/);
  });

  it.each([['mysql'], ['Postgres'], ['postgresql']])(
    'refuses %p as a database and names the setting',
    (kind) => {
      expect(
        refusal({ ...base, MONGO_URI, POSTGRES_URL, DATABASE_TYPE: kind }),
      ).toMatch(/DATABASE_TYPE/);
    },
  );

  it.each([
    ['1', 1],
    ['25', 25],
    ['200', 200],
  ])('takes a pool of %s connections', (given, expected) => {
    expect(
      validateEnvironment({
        ...base,
        DATABASE_TYPE: 'postgres',
        POSTGRES_URL,
        POSTGRES_POOL_MAX: given,
      }).POSTGRES_POOL_MAX,
    ).toBe(expected);
  });

  it('takes a blank pool size from a copied example file as unset', () => {
    expect(
      validateEnvironment({
        ...base,
        DATABASE_TYPE: 'postgres',
        POSTGRES_URL,
        POSTGRES_POOL_MAX: '',
      }).POSTGRES_POOL_MAX,
    ).toBe(10);
  });

  it.each([['0'], ['201'], ['2.5'], ['many']])(
    'refuses a pool of %s connections',
    (given) => {
      expect(
        refusal({
          ...base,
          DATABASE_TYPE: 'postgres',
          POSTGRES_URL,
          POSTGRES_POOL_MAX: given,
        }),
      ).toMatch(/POSTGRES_POOL_MAX/);
    },
  );
});
