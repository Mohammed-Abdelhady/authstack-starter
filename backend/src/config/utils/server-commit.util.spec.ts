import { validateEnvironment } from '../env.validation';
import { parseServerCommit } from './server-commit.util';

const BASE: Record<string, unknown> = {
  MONGO_URI: 'mongodb://localhost:27017/authboiler', // feature:mongodb
  POSTGRES_URL: 'postgres://app:placeholder@localhost:5432/authboiler', // feature:postgres
  CLIENT_URL: 'https://app.example.com',
  OAUTH_STATE_SECRET: 'a'.repeat(32),
};

const COMMIT = '148736220c07b5426ca63dca54b87e2a56bbd330';

describe('public server commit metadata', () => {
  it.each([
    undefined,
    null,
    '',
    ' ',
    123,
    {},
    COMMIT.slice(1),
    COMMIT + 'a',
    ' ' + COMMIT,
    COMMIT + '\n',
    'z' + COMMIT.slice(1),
    'Bearer ' + COMMIT,
  ])('does not publish an invalid configured value, case %#', (value) => {
    expect(parseServerCommit(value)).toBeNull();
  });
});

describe('server revision startup validation', () => {
  it.each([
    null,
    '',
    ' ',
    123,
    {},
    COMMIT.slice(1),
    COMMIT + 'a',
    ' ' + COMMIT,
    COMMIT + '\n',
    'z' + COMMIT.slice(1),
    'Bearer ' + COMMIT,
  ])(
    'refuses invalid deployment metadata without echoing it, case %#',
    (value) => {
      expect(() =>
        validateEnvironment({ ...BASE, SERVER_COMMIT_SHA: value }),
      ).toThrow(
        new Error(
          'SERVER_COMMIT_SHA must be a complete 40-character hexadecimal Git commit.',
        ),
      );
    },
  );
});
