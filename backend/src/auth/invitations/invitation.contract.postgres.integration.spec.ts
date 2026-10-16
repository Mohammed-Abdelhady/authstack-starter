import { bootPostgresInvitationHarness } from '../../../test/postgres/postgres-invitation-harness';
import { describeInvitationContract } from '../../../test/utils/invitation-contract/invitation-contract';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../test/postgres/server/postgres-test-server';

// Loading the other adapter's driver would break a PostgreSQL-only project.
// feature:mongodb:start
jest.mock('mongoose', () => {
  throw new Error('MongoDB driver loaded on PostgreSQL');
});
jest.mock('mongodb', () => {
  throw new Error('MongoDB driver loaded on PostgreSQL');
});
jest.mock('@nestjs/mongoose', () => {
  throw new Error('MongoDB driver loaded on PostgreSQL');
});
// feature:mongodb:end

describeInvitationContract('PostgreSQL', bootPostgresInvitationHarness, {
  bootMs: POSTGRES_BOOT_TIMEOUT_MS,
  resetMs: POSTGRES_RESET_TIMEOUT_MS,
  teardownMs: POSTGRES_TEARDOWN_TIMEOUT_MS,
});
