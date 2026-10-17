import { bootMongoSessionProofHarness } from '../../../../test/utils/session-proof-contract/mongo-session-proof-harness';
import { describeSessionProofContract } from '../../../../test/utils/session-proof-contract/session-proof-contract';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/hook-timeouts';

describeSessionProofContract('MongoDB', bootMongoSessionProofHarness, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
});
