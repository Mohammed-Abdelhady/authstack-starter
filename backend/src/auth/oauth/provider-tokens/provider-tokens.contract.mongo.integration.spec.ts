import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/hook-timeouts';
import { bootMongoProviderTokensHarness } from './persistence/mongo/mongo-provider-tokens.contract.harness-spec';
import { describeProviderTokensContract } from './provider-tokens.contract.harness-spec';

describeProviderTokensContract('MongoDB', bootMongoProviderTokensHarness, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
});
