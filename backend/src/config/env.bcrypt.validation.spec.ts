import { validateEnvironment } from './env.validation';

const BASE: Record<string, unknown> = {
  MONGO_URI: 'mongodb://localhost:27017/authboiler', // feature:mongodb
  POSTGRES_URL: 'postgres://app:placeholder@localhost:5432/authboiler', // feature:postgres
  CLIENT_URL: 'https://app.example.com',
  OAUTH_STATE_SECRET: 'a'.repeat(32),
};

function roundsOf(nodeEnv: string | undefined, rounds: unknown): number {
  return validateEnvironment({
    ...BASE,
    ...(nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv }),
    ...(rounds === undefined ? {} : { BCRYPT_ROUNDS: rounds }),
  }).BCRYPT_ROUNDS;
}

describe('the password hashing cost a server may start with', () => {
  it.each([
    ['production', '10', 10],
    ['production', '14', 14],
    ['development', '10', 10],
    ['development', '12', 12],
    ['test', '4', 4],
    ['test', '14', 14],
  ])('in %s accepts %s', (nodeEnv, rounds, expected) => {
    expect(roundsOf(nodeEnv, rounds)).toBe(expected);
  });

  it.each([
    ['production', '9'],
    ['production', '4'],
    ['production', '15'],
    ['development', '9'],
    ['development', '15'],
    ['test', '3'],
    ['test', '15'],
    ['production', '10.5'],
    ['production', 'ten'],
  ])('in %s refuses %s and names the setting', (nodeEnv, rounds) => {
    expect(() => roundsOf(nodeEnv, rounds)).toThrow(/BCRYPT_ROUNDS/);
  });

  it('refuses a cost below ten when the environment is not named', () => {
    expect(() => roundsOf(undefined, '4')).toThrow(/BCRYPT_ROUNDS/);
  });

  it('starts at ten when the setting is absent', () => {
    expect(roundsOf('production', undefined)).toBe(10);
  });
});
