import { bootPostgresAddressLedgerHarness } from '../../../test/postgres/postgres-address-ledger-harness';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../test/postgres/server/postgres-test-server';
import { describeAddressLedgerContract } from '../../../test/utils/address-ledger-contract/address-ledger-contract';

// feature:mongodb:start
// The ledger must load without the other database's driver.
jest.mock('mongoose', () => {
  throw new Error('mongoose was loaded on the PostgreSQL path');
});
jest.mock('mongodb', () => {
  throw new Error('mongodb was loaded on the PostgreSQL path');
});
jest.mock('@nestjs/mongoose', () => {
  throw new Error('@nestjs/mongoose was loaded on the PostgreSQL path');
});
// feature:mongodb:end

describeAddressLedgerContract('PostgreSQL', bootPostgresAddressLedgerHarness, {
  bootMs: POSTGRES_BOOT_TIMEOUT_MS,
  teardownMs: POSTGRES_TEARDOWN_TIMEOUT_MS,
  resetMs: POSTGRES_RESET_TIMEOUT_MS,
});
