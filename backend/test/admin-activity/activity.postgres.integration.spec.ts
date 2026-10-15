import { bootPostgresProofsEventsHarness } from '../postgres/postgres-proofs-events-harness';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../postgres/server/postgres-test-server';
import { describeActivityContract } from './activity-contract';

describeActivityContract('PostgreSQL', bootPostgresProofsEventsHarness, {
  bootMs: POSTGRES_BOOT_TIMEOUT_MS,
  resetMs: POSTGRES_RESET_TIMEOUT_MS,
  teardownMs: POSTGRES_TEARDOWN_TIMEOUT_MS,
});
