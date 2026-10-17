import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../test/postgres/server/postgres-test-server';
import { describeErasureContract } from './erasure.contract.harness-spec';
import { bootPostgresErasureHarness } from './persistence/postgres/postgres-erasure.contract.harness-spec';

describeErasureContract('PostgreSQL', bootPostgresErasureHarness, {
  bootMs: POSTGRES_BOOT_TIMEOUT_MS,
  resetMs: POSTGRES_RESET_TIMEOUT_MS,
  teardownMs: POSTGRES_TEARDOWN_TIMEOUT_MS,
});
