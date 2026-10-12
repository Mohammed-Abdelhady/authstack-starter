import { describeStoreHealthContract } from '../../../../test/utils/health/store-health-contract';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import { bootMongoHealthHarness } from './mongo-store-health.harness-spec';

describeStoreHealthContract('MongoDB', bootMongoHealthHarness, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
});
