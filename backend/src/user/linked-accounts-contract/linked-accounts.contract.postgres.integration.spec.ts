import { bootPostgresLinkedAccountsHarness } from '../../../test/postgres/postgres-linked-accounts-harness';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../test/postgres/server/postgres-test-server';
import { describeLinkedAccountsContract } from './linked-accounts-contract-suite.harness-spec';

// feature:mongodb:start
// The linking services and their port must run here without the other
// database's driver. Loading any of these modules fails the suite.
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

describeLinkedAccountsContract(
  'PostgreSQL',
  bootPostgresLinkedAccountsHarness,
  {
    bootMs: POSTGRES_BOOT_TIMEOUT_MS,
    teardownMs: POSTGRES_TEARDOWN_TIMEOUT_MS,
    resetMs: POSTGRES_RESET_TIMEOUT_MS,
  },
);
