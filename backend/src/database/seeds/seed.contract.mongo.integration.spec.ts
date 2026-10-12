import { describeSeedContract } from '../../../test/utils/database/seed-contract';
import { bootMongoSeedHarness } from '../../../test/utils/database/mongo-seed-harness';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../test/utils/session-authority-harness';

describeSeedContract('MongoDB', bootMongoSeedHarness, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
});
