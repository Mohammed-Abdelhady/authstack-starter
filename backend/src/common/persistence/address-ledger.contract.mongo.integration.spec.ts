import { bootMongoAddressLedgerHarness } from '../../../test/utils/address-ledger-contract/mongo-address-ledger-harness';
import { describeAddressLedgerContract } from '../../../test/utils/address-ledger-contract/address-ledger-contract';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../test/utils/session-authority-harness';

describeAddressLedgerContract('MongoDB', bootMongoAddressLedgerHarness, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
});
