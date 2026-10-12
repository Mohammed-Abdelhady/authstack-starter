import { holdBefore, RaceGate } from '../../utils/race-gate';
import { describeBrowserIssuanceContract } from '../../utils/session/issuance-contract/issuance-contract';
import { bootPostgresIssuanceHarness } from '../postgres-issuance-harness';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../server/postgres-test-server';

/** One second more than the 5 seconds Jest gives a case that names no budget. */
const HELD_MS = 6000;

// Run only by contract-case-budget.postgres.integration.spec.ts, in a process
// of its own and for one case. The contract runs as it does for a database,
// on a store whose session write waits before it reaches the database.
describeBrowserIssuanceContract(
  'PostgreSQL with a held store call',
  async () => {
    const harness = await bootPostgresIssuanceHarness();
    holdBefore(harness.store, 'insertBrowserSession', () => {
      const gate = new RaceGate();
      // Real time on purpose: the budget under test is one of real time.
      setTimeout(() => gate.release(), HELD_MS).unref();
      return gate;
    });
    return harness;
  },
  {
    bootMs: POSTGRES_BOOT_TIMEOUT_MS,
    teardownMs: POSTGRES_TEARDOWN_TIMEOUT_MS,
    resetMs: POSTGRES_RESET_TIMEOUT_MS,
  },
);
