import { describeStaffSessionsContract } from '../../../test/admin-sessions/session-contract.harness-spec';
import { bootStaffMongo } from '../../../test/admin-sessions/mongo-session-harness.harness-spec';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../test/utils/hook-timeouts';

describeStaffSessionsContract('MongoDB', bootStaffMongo, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
});
