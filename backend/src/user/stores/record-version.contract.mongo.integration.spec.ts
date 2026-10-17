import { bootMongoRecordVersionHarness } from '../../../test/utils/record-version-contract/mongo-record-version-harness';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../test/utils/hook-timeouts';
import { describeRecordVersionContract } from '../../../test/utils/record-version-contract/record-version-contract';
describeRecordVersionContract('MongoDB', bootMongoRecordVersionHarness, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
});
