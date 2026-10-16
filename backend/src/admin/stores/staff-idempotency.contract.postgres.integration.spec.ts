import { bootPostgresStaffIdempotencyHarness } from '../../../test/postgres/postgres-staff-idempotency-harness';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../test/postgres/server/postgres-test-server';
import { describeStaffIdempotencyContract } from '../../../test/utils/staff-idempotency-contract/staff-idempotency-contract';

// feature:mongodb:start
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

describeStaffIdempotencyContract(
  'PostgreSQL',
  bootPostgresStaffIdempotencyHarness,
  {
    bootMs: POSTGRES_BOOT_TIMEOUT_MS,
    teardownMs: POSTGRES_TEARDOWN_TIMEOUT_MS,
    resetMs: POSTGRES_RESET_TIMEOUT_MS,
  },
);
