import { describeStaffSessionsContract } from '../../../test/admin-sessions/session-contract.harness-spec';
import { bootStaffPostgres } from '../../../test/admin-sessions/postgres-session-harness.harness-spec';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../test/postgres/server/postgres-test-server';

describeStaffSessionsContract('PostgreSQL', bootStaffPostgres, {
  bootMs: POSTGRES_BOOT_TIMEOUT_MS,
  resetMs: POSTGRES_RESET_TIMEOUT_MS,
  teardownMs: POSTGRES_TEARDOWN_TIMEOUT_MS,
});
