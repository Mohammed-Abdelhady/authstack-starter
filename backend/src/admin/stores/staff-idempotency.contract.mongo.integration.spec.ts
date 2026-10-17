import { bootMongoStaffIdempotencyHarness } from '../../../test/utils/staff-idempotency-contract/mongo-staff-idempotency-harness';
import { describeStaffIdempotencyContract } from '../../../test/utils/staff-idempotency-contract/staff-idempotency-contract';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../test/utils/session-authority-harness';

describeStaffIdempotencyContract('MongoDB', bootMongoStaffIdempotencyHarness, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
});
