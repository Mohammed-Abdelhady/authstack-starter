import {
  bootPostgresIssuanceHarness,
  PostgresIssuanceHarness,
} from '../postgres-issuance-harness';
import { openTestConnectionOn, TestConnection } from '../postgres-connection';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../server/postgres-test-server';
import {
  ABANDONED_WORK,
  abandonWorkOnAnAccount,
  FAILED_ON_PURPOSE,
  interruptAReset,
  openWorkOn,
  PLANNED_FAILURE_BUDGET_MS,
  StepBeforeNextStatement,
  storedAccounts,
} from './abandoned-work';

// Run only by postgres-harness-teardown.integration.spec.ts, in a process of
// its own. Two cases of the first suite fail on purpose.
describe('a suite whose cases abandon open work', () => {
  let harness: PostgresIssuanceHarness;

  beforeAll(async () => {
    harness = await bootPostgresIssuanceHarness();
  }, POSTGRES_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await harness?.close();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  it(
    'fails with an account held and a second writer waiting',
    async () => {
      await abandonWorkOnAnAccount(harness);
      expect(await openWorkOn(harness)).toEqual(ABANDONED_WORK);

      throw new Error(FAILED_ON_PURPOSE);
    },
    PLANNED_FAILURE_BUDGET_MS,
  );

  it('starts the next case on empty tables', async () => {
    // The failed case's work is still open when this one starts.
    expect(await openWorkOn(harness)).toEqual(ABANDONED_WORK);

    await harness.reset();
    await harness.seedAccount();

    expect(await storedAccounts(harness)).toBe(1);
  });

  it(
    'fails again as the last case, so teardown meets the open work',
    async () => {
      await abandonWorkOnAnAccount(harness);
      // The account the case before stored, and this one's.
      expect(await openWorkOn(harness)).toEqual({
        ...ABANDONED_WORK,
        accounts: 2,
      });

      throw new Error(FAILED_ON_PURPOSE);
    },
    PLANNED_FAILURE_BUDGET_MS,
  );
});

// Boots its own server after the first suite's teardown, in the same process.
describe('the suite that runs next', () => {
  let harness: PostgresIssuanceHarness;

  beforeAll(async () => {
    harness = await bootPostgresIssuanceHarness();
  }, POSTGRES_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await harness?.close();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  it('starts on empty tables and stores its own account', async () => {
    await harness.reset();
    await harness.seedAccount();

    expect(await storedAccounts(harness)).toBe(1);
  });
});

// The first case ends with its reset still running, as a reset that ran out
// of its budget does.
describe('a suite whose reset is cut short', () => {
  let connection: TestConnection<StepBeforeNextStatement>;
  let cutShort: Promise<void>;

  beforeAll(async () => {
    connection = await openTestConnectionOn(
      (pool) => new StepBeforeNextStatement({ pool }),
    );
  }, POSTGRES_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await connection?.close();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  it(
    'fails with its reset still waiting on an account taken after it began',
    async () => {
      cutShort = (await interruptAReset(connection)).settled;
      expect(await openWorkOn(connection)).toEqual(ABANDONED_WORK);

      throw new Error(FAILED_ON_PURPOSE);
    },
    PLANNED_FAILURE_BUDGET_MS,
  );

  it('starts the next case on empty tables and keeps what it stores', async () => {
    // The reset that was cut short is still waiting when this case starts.
    expect(await openWorkOn(connection)).toEqual(ABANDONED_WORK);

    await connection.reset();
    await connection.database
      .insertInto('users')
      .values({ is_deleted: false })
      .execute();

    // Whether the earlier reset finished or was ended, it is over by now
    // and has not emptied what this case stored.
    await cutShort;

    expect(await storedAccounts(connection)).toBe(1);
  });
});

// Its boot fails after the server is up, so no harness exists to close.
describe('a suite whose boot fails part way', () => {
  beforeAll(async () => {
    await openTestConnectionOn(() => {
      throw new Error(FAILED_ON_PURPOSE);
    });
  }, POSTGRES_BOOT_TIMEOUT_MS);

  it('never runs its case', () => {
    expect(true).toBe(true);
  });
});
