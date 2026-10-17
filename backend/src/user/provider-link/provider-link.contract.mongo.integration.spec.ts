import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../test/utils/hook-timeouts';
import { bootMongoProviderLinkHarness } from './persistence/mongo/mongo-provider-link.harness-spec';
import { describeProviderLinkContract } from './provider-link.contract.harness-spec';

describeProviderLinkContract('MongoDB', bootMongoProviderLinkHarness, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
});
