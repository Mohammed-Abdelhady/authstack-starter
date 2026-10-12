import { bootPostgresProofsEventsHarness } from '../../../test/postgres/postgres-proofs-events-harness';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../test/postgres/server/postgres-test-server';
import { describeProofsEventsContract } from '../../../test/utils/session/proofs-events-contract/proofs-events-contract';

// feature:mongodb:start
// The proof service, the event recorder and their ports must run here without
// the other database's driver. Loading any of these modules fails the suite.
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

describeProofsEventsContract('PostgreSQL', bootPostgresProofsEventsHarness, {
  bootMs: POSTGRES_BOOT_TIMEOUT_MS,
  teardownMs: POSTGRES_TEARDOWN_TIMEOUT_MS,
  resetMs: POSTGRES_RESET_TIMEOUT_MS,
});
