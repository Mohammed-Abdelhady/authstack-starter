import {
  bootPostgresAccountsHarness,
  type PostgresAccountsHarness,
} from '../../../test/postgres/postgres-accounts-harness';
import { openTestConnection } from '../../../test/postgres/postgres-connection';
import {
  DEFAULT_SLUG,
  refusalOf,
  servicesOn,
} from '../../../test/utils/user/accounts-contract/accounts-contract-support';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../test/postgres/server/postgres-test-server';
import { describeAccountStoresContract } from '../../../test/utils/user/accounts-contract/accounts-contract';

// feature:mongodb:start
// The account services and their ports must run here without the other
// database's driver. Loading any of these modules fails the suite.
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

describeAccountStoresContract('PostgreSQL', bootPostgresAccountsHarness, {
  bootMs: POSTGRES_BOOT_TIMEOUT_MS,
  teardownMs: POSTGRES_TEARDOWN_TIMEOUT_MS,
  resetMs: POSTGRES_RESET_TIMEOUT_MS,
});

const ONE_CONNECTION = 1;
const FREE_CONNECTION_WAIT_MS = 500;

describe('own-profile writes with one PostgreSQL connection', () => {
  let harness: PostgresAccountsHarness;

  beforeAll(async () => {
    harness = await bootPostgresAccountsHarness(() =>
      openTestConnection({
        max: ONE_CONNECTION,
        connectionTimeoutMillis: FREE_CONNECTION_WAIT_MS,
      }),
    );
  }, POSTGRES_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await harness?.close();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  it('persists an observed-version edit and refuses a stale overwrite', async () => {
    await harness.reset();
    await harness.seedRole({
      name: 'User',
      slug: DEFAULT_SLUG,
      permissions: [],
    });
    const id = await harness.seedAccount({
      email: 'profile-single@example.test',
      name: 'Original profile',
      role: DEFAULT_SLUG,
    });
    const profile = servicesOn(harness).profile;
    const observed = await profile.getProfile(id);
    expect(observed.data.version).toBe(0);

    const updated = await profile.updateProfile(id, {
      name: 'Committed profile',
      version: observed.data.version,
    });
    expect(updated.data).toMatchObject({
      name: 'Committed profile',
      version: 1,
    });
    const stored = () =>
      harness.database
        .selectFrom('users')
        .select(['name', 'version'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
    expect(await stored()).toEqual({ name: 'Committed profile', version: 1 });

    expect(
      await refusalOf(
        profile.updateProfile(id, {
          name: 'Stale profile',
          version: observed.data.version,
        }),
      ),
    ).toEqual({ code: 'CONFLICT', status: 409 });
    expect(await stored()).toEqual({ name: 'Committed profile', version: 1 });
  });
});
