import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import { describeMagicLinkContract } from './magic-link-contract-suite.harness-spec';
import { bootMongoMagicLinkHarness } from '../persistence/mongo/contract/mongo-magic-link.harness-spec';

describeMagicLinkContract('MongoDB', bootMongoMagicLinkHarness, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
});
