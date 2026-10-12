import { join } from 'node:path';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../test/postgres/server/postgres-test-server';
import {
  StartedFixtureRun,
  startFixtureSuites,
} from '../../../test/postgres/teardown-fixtures/run-fixture-suites';

const BUDGET_FIXTURES = join(
  __dirname,
  '..',
  '..',
  '..',
  'test',
  'postgres',
  'budget-fixtures',
);
const HELD_SUITE =
  'browser sign-in contract on PostgreSQL with a held store call';
const HELD_CASE =
  'stores the session, its grant, both counters and the event for a first sign-in';
// The fixture suite boots a server and stops it, on the budgets those hooks
// have, and its one case runs for the 5 seconds Jest gives it.
const ONE_SUITE_MS = POSTGRES_BOOT_TIMEOUT_MS + POSTGRES_TEARDOWN_TIMEOUT_MS;

/**
 * A contract case names no budget, so a store call that waits longer than
 * Jest's default fails the case even when the call then succeeds.
 */
describe('the budget of a contract case', () => {
  let run: StartedFixtureRun | undefined;

  afterEach(() => {
    run?.kill();
    run = undefined;
  });

  it(
    'fails a case whose store call is held for 6 seconds and then succeeds',
    async () => {
      run = startFixtureSuites({
        folder: BUDGET_FIXTURES,
        onlyCase: HELD_CASE,
      });

      const outcome = await run.finished;

      expect({
        exitCode: outcome.exitCode,
        ran: outcome.cases.filter((held) => held.status !== 'pending'),
      }).toEqual({
        exitCode: 1,
        ran: [
          {
            suite: HELD_SUITE,
            title: HELD_CASE,
            status: 'failed',
            failures: [
              'Error: thrown: "Exceeded timeout of 5000 ms for a test.',
            ],
          },
        ],
      });
    },
    ONE_SUITE_MS,
  );
});
