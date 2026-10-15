import { bootPostgresRoleHarness } from '../postgres/postgres-role-harness';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../postgres/server/postgres-test-server';
import { describeActivityRoleEvidence } from './activity-role-evidence-cases';

describeActivityRoleEvidence('PostgreSQL', bootPostgresRoleHarness, {
  bootMs: POSTGRES_BOOT_TIMEOUT_MS,
  resetMs: POSTGRES_RESET_TIMEOUT_MS,
  teardownMs: POSTGRES_TEARDOWN_TIMEOUT_MS,
});
