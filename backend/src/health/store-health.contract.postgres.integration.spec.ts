import {
  bootPostgresHealthHarness,
  PostgresHealthHarness,
} from '../../test/postgres/postgres-health-harness';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../test/postgres/server/postgres-test-server';
import { describeStoreHealthContract } from '../../test/utils/health/store-health-contract';

// feature:mongodb:start
// The health service and its port must run here without the other database's
// driver. Loading any of these modules fails the suite.
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

let booted: PostgresHealthHarness | undefined;

describeStoreHealthContract(
  'PostgreSQL',
  async () => {
    booted = await bootPostgresHealthHarness();
    return booted;
  },
  {
    bootMs: POSTGRES_BOOT_TIMEOUT_MS,
    teardownMs: POSTGRES_TEARDOWN_TIMEOUT_MS,
  },
);

describe('PostgreSQL store health before it has looked', () => {
  it('says unreachable until the server has answered once', () => {
    // Runs after the contract booted the server this adapter points at.
    expect(booted?.unobserved.current()).toBe('unreachable');
  });
});
