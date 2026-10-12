import { describeAccountStoresContract } from '../../../test/utils/user/accounts-contract/accounts-contract';
import { bootMongoAccountsHarness } from '../../../test/utils/user/accounts-contract/mongo-accounts-harness';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../test/utils/session-authority-harness';

describeAccountStoresContract('MongoDB', bootMongoAccountsHarness, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
});
