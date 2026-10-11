import {
  chosenStorage,
  confirmStorageChoice,
  forgetStorageChoice,
  forStorage,
  storageKindOf,
} from './storage-choice';

describe('the database choice', () => {
  const environment = { ...process.env };

  beforeEach(() => {
    forgetStorageChoice();
    delete process.env.DATABASE_TYPE;
  });

  afterEach(() => {
    process.env = { ...environment };
    forgetStorageChoice();
  });

  it.each([
    [undefined, 'mongodb'],
    [null, 'mongodb'],
    ['', 'mongodb'],
    ['mongodb', 'mongodb'],
    ['postgres', 'postgres'],
  ])('reads %p as %s', (value, expected) => {
    expect(storageKindOf(value)).toBe(expected);
  });

  it.each([
    ['mysql'],
    ['Postgres'],
    ['postgresql'],
    [' postgres'],
    [7],
    [true],
  ])('refuses %p and names the setting', (value) => {
    expect(() => storageKindOf(value)).toThrow(/DATABASE_TYPE/);
  });

  it('never puts a refused value that is not text into the message', () => {
    expect(() => storageKindOf({ secret: 'hunter2' })).toThrow(
      'DATABASE_TYPE must be one of mongodb, postgres, got object',
    );
  });

  it('takes the environment as it is when asked, MongoDB when it names nothing', () => {
    const unset = chosenStorage();
    process.env.DATABASE_TYPE = 'postgres';
    const set = chosenStorage();

    expect({ unset, set }).toEqual({ unset: 'mongodb', set: 'postgres' });
  });

  it('builds the chosen adapter wiring and never the other one', () => {
    const built: string[] = [];
    const wiring = {
      mongodb: () => {
        built.push('mongodb');
        return 'mongo wiring';
      },
      postgres: () => {
        built.push('postgres');
        return 'postgres wiring';
      },
    };

    const byDefault = forStorage(wiring);
    process.env.DATABASE_TYPE = 'postgres';
    forgetStorageChoice();
    const chosen = forStorage(wiring);

    expect({ byDefault, chosen, built }).toEqual({
      byDefault: 'mongo wiring',
      chosen: 'postgres wiring',
      built: ['mongodb', 'postgres'],
    });
  });

  it('refuses a database this build carries no adapter for', () => {
    process.env.DATABASE_TYPE = 'postgres';

    expect(() => forStorage({ mongodb: () => 'mongo wiring' })).toThrow(
      'DATABASE_TYPE is "postgres", and this build does not carry that adapter',
    );
  });

  it('refuses the default database without naming a setting when none was given', () => {
    const refusal = (): string => {
      try {
        forStorage({ postgres: () => 'postgres wiring' });
      } catch (error) {
        return error instanceof Error ? error.message : 'not an error';
      }
      return 'wired';
    };

    expect({
      namesTheDatabase: refusal().includes('"mongodb"'),
      namesTheSetting: refusal().includes('DATABASE_TYPE'),
    }).toEqual({ namesTheDatabase: true, namesTheSetting: false });
  });

  it('accepts the validated setting when nothing was wired, or wired the same', () => {
    confirmStorageChoice('postgres');
    forStorage({ mongodb: () => 1, postgres: () => 2 });

    expect(() => confirmStorageChoice(undefined)).not.toThrow();
    expect(() => confirmStorageChoice('mongodb')).not.toThrow();
  });

  it('refuses a validated setting that differs from what modules were wired for', () => {
    forStorage({ mongodb: () => 1, postgres: () => 2 });

    expect(() => confirmStorageChoice('postgres')).toThrow(
      'DATABASE_TYPE is "postgres", but modules were already wired for "mongodb". Load the configuration before any module file.',
    );
  });
});
