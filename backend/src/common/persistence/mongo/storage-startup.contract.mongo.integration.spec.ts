import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import { describeStorageStartupContract } from '../../../../test/utils/startup/storage-startup-contract';
import { bootMongoStartupHarness } from './mongo-storage-startup.harness-spec';

describeStorageStartupContract('MongoDB', bootMongoStartupHarness, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  behind: null,
  ahead: null,
});
