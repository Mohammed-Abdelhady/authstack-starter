import { bootPostgresAccountsHarness } from '../../../../test/postgres/postgres-accounts-harness';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/postgres/server/postgres-test-server';
import { describePasswordCredentials } from './password-credentials.harness-spec';

describePasswordCredentials('PostgreSQL', bootPostgresAccountsHarness, {
  bootMs: POSTGRES_BOOT_TIMEOUT_MS,
  teardownMs: POSTGRES_TEARDOWN_TIMEOUT_MS,
  resetMs: POSTGRES_RESET_TIMEOUT_MS,
});
