import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../test/utils/hook-timeouts';
import { describeErasureContract } from './erasure.contract.harness-spec';
import { bootMongoErasureHarness } from './persistence/mongo/mongo-erasure.contract.harness-spec';

describeErasureContract('MongoDB', bootMongoErasureHarness, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
});
