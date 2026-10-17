import { bootPostgresRecordVersionHarness } from '../../../test/postgres/postgres-record-version-harness';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../test/postgres/server/postgres-test-server';
import { describeRecordVersionContract } from '../../../test/utils/record-version-contract/record-version-contract';
describeRecordVersionContract('PostgreSQL', bootPostgresRecordVersionHarness, {
  bootMs: POSTGRES_BOOT_TIMEOUT_MS,
  resetMs: POSTGRES_RESET_TIMEOUT_MS,
  teardownMs: POSTGRES_TEARDOWN_TIMEOUT_MS,
});
