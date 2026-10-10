import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../test/postgres/server/postgres-test-server';
import {
  StartedFixtureRun,
  startFixtureSuites,
} from '../../../test/postgres/teardown-fixtures/run-fixture-suites';

const ABANDONING_SUITE = 'a suite whose cases abandon open work';
const NEXT_SUITE = 'the suite that runs next';
const CUT_SHORT_SUITE = 'a suite whose reset is cut short';
const FAILED_BOOT_SUITE = 'a suite whose boot fails part way';
// Four suites boot a server each and stop it, on the budgets those hooks have.
const FOUR_SUITES_MS =
  4 * (POSTGRES_BOOT_TIMEOUT_MS + POSTGRES_TEARDOWN_TIMEOUT_MS);

/**
 * A case that fails or runs out of its budget leaves a transaction open and a
 * connection checked out, a reset that runs out of its budget is still running,
 * and a boot can fail with its server already up. The harness must still leave
 * the next case empty tables, stop its server and let the process end.
 */
describe('PostgreSQL harness teardown after abandoned work', () => {
  let run: StartedFixtureRun | undefined;

  afterEach(() => {
    run?.kill();
    run = undefined;
  });

  it(
    'cleans up after each failed case, a reset cut short and a failed boot, lets the next suite start, and the process exits by itself',
    async () => {
      run = startFixtureSuites();

      const outcome = await run.finished;

      expect(outcome).toEqual({
        exitCode: 1,
        cases: [
          {
            suite: ABANDONING_SUITE,
            title: 'fails with an account held and a second writer waiting',
            status: 'failed',
          },
          {
            suite: ABANDONING_SUITE,
            title: 'starts the next case on empty tables',
            status: 'passed',
          },
          {
            suite: ABANDONING_SUITE,
            title:
              'fails again as the last case, so teardown meets the open work',
            status: 'failed',
          },
          {
            suite: NEXT_SUITE,
            title: 'starts on empty tables and stores its own account',
            status: 'passed',
          },
          {
            suite: CUT_SHORT_SUITE,
            title:
              'fails with its reset still waiting on an account taken after it began',
            status: 'failed',
          },
          {
            suite: CUT_SHORT_SUITE,
            title:
              'starts the next case on empty tables and keeps what it stores',
            status: 'passed',
          },
          {
            suite: FAILED_BOOT_SUITE,
            title: 'never runs its case',
            status: 'failed',
          },
        ],
      });
    },
    FOUR_SUITES_MS,
  );
});
