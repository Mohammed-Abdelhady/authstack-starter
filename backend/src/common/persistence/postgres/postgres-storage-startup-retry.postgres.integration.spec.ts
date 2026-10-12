import { Pool } from 'pg';
import { openTestConnection } from '../../../../test/postgres/postgres-connection';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/postgres/server/postgres-test-server';
import { PostgresStorageStartup } from './postgres-storage-startup';

describe('PostgreSQL startup transient connection recovery', () => {
  let pool: Pool;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const connection = await openTestConnection();
    pool = connection.pool;
    close = connection.close;
  }, POSTGRES_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await close?.();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  it('reads real migration state after one connection reset', async () => {
    const failure = Object.assign(new Error('socket closed'), {
      code: 'ECONNRESET',
    });
    const query = jest.spyOn(pool, 'query').mockImplementationOnce(() => {
      throw failure;
    });
    try {
      await expect(
        new PostgresStorageStartup(pool).prepare(),
      ).resolves.toBeUndefined();
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      query.mockRestore();
    }
  });
});
