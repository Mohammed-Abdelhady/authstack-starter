import { describeProofsEventsContract } from '../../../test/utils/session/proofs-events-contract/proofs-events-contract';
import { bootMongoProofsEventsHarness } from '../../../test/utils/session/proofs-events-contract/mongo-proofs-events-harness';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../test/utils/session-authority-harness';

describeProofsEventsContract('MongoDB', bootMongoProofsEventsHarness, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
});
