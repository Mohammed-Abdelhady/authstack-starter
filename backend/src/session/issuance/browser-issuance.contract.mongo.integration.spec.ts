import { describeBrowserIssuanceContract } from '../../../test/utils/session/issuance-contract/issuance-contract';
import { bootMongoIssuanceHarness } from '../../../test/utils/session/issuance-contract/mongo-issuance-harness';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../test/utils/session-authority-harness';

describeBrowserIssuanceContract('MongoDB', bootMongoIssuanceHarness, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
});
