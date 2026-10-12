import { bootPostgresAuthorityHarness } from '../../../test/postgres/postgres-authority-harness';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../test/postgres/server/postgres-test-server';
import { describeSessionAuthorityContract } from '../../../test/utils/session/authority-contract/authority-contract';

// feature:mongodb:start
// The validator, the revoker and their ports must run here without the other
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

describeSessionAuthorityContract('PostgreSQL', bootPostgresAuthorityHarness, {
  bootMs: POSTGRES_BOOT_TIMEOUT_MS,
  teardownMs: POSTGRES_TEARDOWN_TIMEOUT_MS,
  resetMs: POSTGRES_RESET_TIMEOUT_MS,
});
