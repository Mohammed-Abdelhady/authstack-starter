import { bootMongoRoleHarness } from '../utils/role/role-contract/mongo-role-harness';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/session-authority-harness';
import { describeActivityRoleEvidence } from './activity-role-evidence-cases';

describeActivityRoleEvidence('MongoDB', bootMongoRoleHarness, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
});
