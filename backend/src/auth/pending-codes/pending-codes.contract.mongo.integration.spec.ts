import { bootMongoPendingCodesHarness } from '../../../test/utils/auth/pending-codes-contract/mongo-pending-codes-harness';
import { describePendingCodesContract } from '../../../test/utils/auth/pending-codes-contract/pending-codes-contract';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../test/utils/session-authority-harness';

describePendingCodesContract('MongoDB', bootMongoPendingCodesHarness, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
});
