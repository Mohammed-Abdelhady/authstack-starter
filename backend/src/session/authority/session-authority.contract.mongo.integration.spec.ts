import { describeSessionAuthorityContract } from '../../../test/utils/session/authority-contract/authority-contract';
import { bootMongoAuthorityHarness } from '../../../test/utils/session/authority-contract/mongo-authority-harness';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../test/utils/session-authority-harness';

describeSessionAuthorityContract('MongoDB', bootMongoAuthorityHarness, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
});
