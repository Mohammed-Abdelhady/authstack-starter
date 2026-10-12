import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../test/utils/session-authority-harness';
import { describeLinkedAccountsContract } from './linked-accounts-contract-suite.harness-spec';
import { bootMongoLinkedAccountsHarness } from '../persistence/mongo/linked-accounts-contract/mongo-linked-accounts.harness-spec';

describeLinkedAccountsContract('MongoDB', bootMongoLinkedAccountsHarness, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
});
