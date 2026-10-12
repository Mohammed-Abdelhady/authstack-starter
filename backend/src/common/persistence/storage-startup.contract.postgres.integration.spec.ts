import {
  bootPostgresStartupHarness,
  prepareOnEmptyDatabase,
} from '../../../test/postgres/postgres-startup-harness';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../test/postgres/server/postgres-test-server';
import { describeStorageStartupContract } from '../../../test/utils/startup/storage-startup-contract';

// feature:mongodb:start
// The start-up port must run here without the other database's driver.
jest.mock('mongoose', () => {
  throw new Error('mongoose was loaded on the PostgreSQL path');
});
jest.mock('mongodb', () => {
  throw new Error('mongodb was loaded on the PostgreSQL path');
});
jest.mock('@nestjs/mongoose', () => {
  throw new Error('@nestjs/mongoose was loaded on the PostgreSQL path');
});
// feature:mongodb:end

describeStorageStartupContract('PostgreSQL', bootPostgresStartupHarness, {
  bootMs: POSTGRES_BOOT_TIMEOUT_MS,
  teardownMs: POSTGRES_TEARDOWN_TIMEOUT_MS,
  behind:
    'The database is behind this build. Apply these migrations in order, then start again: 9999_not_applied_yet.sql',
  ahead:
    'The database holds migrations this build does not carry: 0002_roles.sql. Start the build that carries them, or restore the database.',
});

/**
 * The case starts a server of its own while other suites start theirs.
 * Slowest measured: 33 seconds.
 */
const OWN_SERVER_CASE_MS = 70_000;

describe('PostgreSQL storage start-up on a database nothing was applied to', () => {
  it(
    'refuses with every migration this build carries, in order, and creates no record',
    async () => {
      expect(
        await prepareOnEmptyDatabase(['0001_first.sql', '0002_second.sql']),
      ).toEqual({
        refused:
          'The database is behind this build. Apply these migrations in order, then start again: 0001_first.sql, 0002_second.sql',
        record: null,
      });
    },
    OWN_SERVER_CASE_MS,
  );
});
